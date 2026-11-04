import * as XLSX from "xlsx";
export type PickupLine={sheet:string;row:number;mark:string;so:string;bales:number;weight:number|null;warehouse:string;warehouseCode:string;address:string[];rtl:string|null};
export type Location={id:string;mcleod_code:string;prev_code:string|null;name:string;address:string|null;city:string|null;state:string|null;timezone:string|null};
export type Schedule={location_id:string;weekday:number|null;open_time:string|null;close_time:string|null;checkin_cutoff:string|null;verified:boolean|null;appointment_required:boolean|null;effective_from:string|null;effective_to:string|null;created_at:string;source_reference:string|null};
export type Proposal={key:string;so:string;mark:string;blnum:string;bales:number;customerId:string;revenue:string;destination:string;pickups:{location:Location|null;warehouseCode:string;warehouse:string;bales:number;rtl:string|null;sourceRows:string[];address:string[];hours:Schedule|null;issues:string[]}[];issues:string[]};
const norm=(v:unknown)=>String(v??"").trim().replace(/\s+/g," ");
const header=(v:unknown)=>norm(v).toUpperCase().replace(/[^A-Z0-9]/g,"");
function date(v:unknown):string|null{
 if(v==null||norm(v)==="")return null;
 let y:number,m:number,d:number;
 if(typeof v==="number"){const p=XLSX.SSF.parse_date_code(v);if(!p)throw Error("Invalid RTL date");({y,m,d}=p)}
 else{const s=norm(v);const match=s.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{2,4})$/);if(!match)throw Error("Invalid RTL date: "+s);[y,m,d]=match[1].length===4?[+match[1],+match[2],+match[3]]:[+match[3],+match[1],+match[2]];if(y<100)y+=2000;}
 const dt=new Date(Date.UTC(y,m-1,d));if(y<2000||y>2100||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)throw Error("Invalid RTL date");return dt.toISOString().slice(0,10);
}
export function parseDispatch(bytes:Uint8Array){
 const wb=XLSX.read(bytes,{type:"array",cellDates:false});const lines:PickupLine[]=[];const destinations=new Set<string>();let matchedSheets=0;const excluded:{sheet:string;row:number;reason:string}[]=[];
 for(const sheet of wb.SheetNames){const rows=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet],{header:1,raw:true,defval:""});
 const h=rows.findIndex(r=>r.some(v=>header(v)==="MARK")&&r.some(v=>header(v)==="SO")&&r.some(v=>header(v)==="BALES")&&r.some(v=>header(v)==="WAREHOUSE"));if(h<0)continue;matchedSheets++;
 const headers=rows[h].map(header),mark=headers.indexOf("MARK"),so=headers.indexOf("SO"),bales=headers.indexOf("BALES"),warehouse=headers.indexOf("WAREHOUSE"),weight=headers.indexOf("WEIGHT"),rtl=headers.findIndex(v=>["LOADRTL","READYCONFIRMEDLOADRTL","RTL","READYDATE"].includes(v));
 if(warehouse<1||rtl<0)throw Error(sheet+": Warehouse code or RTL column unavailable");
 let carrier="";
 for(const r of rows.slice(0,h)){const i=r.findIndex(v=>header(v)==="DESTINATION");if(i>=0)destinations.add(norm(r[i+1]));const c=r.findIndex(v=>header(v)==="CARRIER");if(c>=0)carrier=norm(r[c+1]);}
 let last:PickupLine|null=null;
 for(let i=h+1;i<rows.length;i++){const r=rows[i],m=norm(r[mark]),s=norm(r[so]),b=norm(r[bales]);
 if(header(m)==="CARRIER"){carrier=s;last=null;continue}
 if(header(m)==="DESTINATION"){destinations.add(s);last=null;continue}
 if(header(m)==="MARK"&&header(s)==="SO"){last=null;continue}
 if(m&&s){
 if(!/SUPPLY\s+CHAIN\s+MANAGEMENT/i.test(carrier)){excluded.push({sheet,row:i+1,reason:"Carrier section is not Supply Chain Management: "+(carrier||"missing")});last=null;continue}
 if(!/^[A-Za-z0-9-]{1,30}$/.test(m)||!/^\d{1,20}$/.test(s)||!Number.isSafeInteger(Number(b))||Number(b)<=0)throw Error(`${sheet} row ${i+1}: invalid mark, SO or bale count`);
 const code=norm(r[warehouse-1]);if(code&&!/^\d{6}$/.test(code))throw Error(`${sheet} row ${i+1}: invalid warehouse code`);
 last={sheet,row:i+1,mark:m.toUpperCase(),so:s,bales:Number(b),weight:weight>=0&&norm(r[weight])?Number(r[weight]):null,warehouse:norm(r[warehouse]),warehouseCode:code,address:[],rtl:date(r[rtl])};
 if(!last.warehouse)throw Error(`${sheet} row ${i+1}: warehouse missing`);lines.push(last);
 }else if((m||s)&&b&&Number.isFinite(Number(b))){throw Error(`${sheet} row ${i+1}: missing mark or SO on pickup row`)}else if(last&&!m&&!s){const part=norm(r[warehouse]);if(part&&last.address.length<4)last.address.push(part)}
 }
 }
 if(!matchedSheets||!lines.length)throw Error("No Bunge dispatch pickup rows found. Upload the original dispatch workbook with Mark, SO, Bales, Warehouse and Load (RTL) headers.");
 if(lines.length>250)throw Error("Preview up to 250 pickup rows at a time.");
 // Only inherit a code when the exact warehouse label has one explicit code in this workbook.
 const codes=new Map<string,Set<string>>();for(const l of lines){const k=header(l.warehouse);if(!codes.has(k))codes.set(k,new Set());if(l.warehouseCode)codes.get(k)!.add(l.warehouseCode)}
 for(const l of lines)if(!l.warehouseCode){const set=codes.get(header(l.warehouse));if(set?.size===1)l.warehouseCode=[...set][0]}
 return {lines,destinations:[...destinations],excluded};
}
export function buildPreview(lines:PickupLine[],locations:Location[],schedules:Schedule[],revenue:"MAIN"|"DAVIS",destination="SAVAGAG2"):Proposal[]{
 const groups=new Map<string,PickupLine[]>();for(const l of lines){const k=l.so+":"+l.mark;groups.set(k,[...(groups.get(k)||[]),l])}
 return [...groups].map(([key,source])=>{
 const first=source[0],bales=source.reduce((n,l)=>n+l.bales,0);if(!Number.isSafeInteger(bales))throw Error("Grouped bale total exceeds supported range.");const issues:string[]=[];
 const fingerprints=source.map(l=>[l.warehouseCode,l.warehouse,l.rtl,l.bales].join("|"));if(new Set(fingerprints).size!==fingerprints.length)issues.push("Repeated identical pickup lines: verify bale total before creating.");
 const stops=new Map<string,PickupLine[]>();for(const l of source){const k=(l.warehouseCode||header(l.warehouse))+":"+l.rtl;stops.set(k,[...(stops.get(k)||[]),l])}
 const pickups=[...stops.values()].map(part=>{
 const line=part[0],matches=line.warehouseCode?locations.filter(l=>norm(l.prev_code)===line.warehouseCode||l.mcleod_code===line.warehouseCode):[];const location=matches.length===1?matches[0]:null;const stopIssues:string[]=[];
 if(!line.warehouseCode)stopIssues.push("No unique warehouse code in source workbook.");else if(!location)stopIssues.push(matches.length?"Warehouse code matches multiple locations.":"Warehouse code is not mapped.");
 if(!line.rtl)stopIssues.push("RTL date missing.");
 if(location&&!location.timezone)stopIssues.push("Location timezone must be confirmed before scheduling.");
 const weekday=line.rtl?new Date(line.rtl+"T12:00:00Z").getUTCDay():null;
 const eligible=location&&line.rtl?schedules.filter(s=>s.location_id===location.id&&(s.weekday==null||s.weekday===weekday)&&(!s.effective_from||s.effective_from<=line.rtl!)&&(!s.effective_to||s.effective_to>=line.rtl!)).sort((a,b)=>b.created_at.localeCompare(a.created_at)):[];
 const hours=eligible[0]||null;
 if(!hours)stopIssues.push("No pickup hours for this date; confirm weekday/seasonal availability.");else if(!hours.verified)stopIssues.push("Suggested hours are unverified historical information.");
 if(hours&&!hours.open_time&&!hours.close_time)stopIssues.push("Pickup time window is unknown.");
 return {location,warehouseCode:line.warehouseCode,warehouse:line.warehouse,bales:part.reduce((n,l)=>n+l.bales,0),rtl:line.rtl,sourceRows:part.map(l=>l.sheet+":"+l.row),address:part.find(l=>l.address.length)?.address||[],hours,issues:stopIssues};
 });
 if(pickups.length>2)issues.push("More than two pickup stops: manual review required.");
 if(!locations.some(l=>l.mcleod_code===destination))issues.push("Delivery location is not in the location database; confirm in McLeod.");
 return {key,so:first.so,mark:first.mark,blnum:`${first.mark} ${bales} BALES`,bales,customerId:"BUNGOMNE",revenue,destination,pickups,issues};
 });
}
