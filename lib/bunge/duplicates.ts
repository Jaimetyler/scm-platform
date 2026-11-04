import {extractSearchOrders} from "@/lib/mcleod/inbound/search-response";
import {pickupMonthRanges,scheduledPickupDay} from "./duplicate-window";
export function canonicalBlnum(value:unknown):string|null{
 if(typeof value!=="string")return null;
 const m=value.trim().toUpperCase().match(/^([A-Z0-9-]{1,30})\s+([1-9]\d{0,6})\s+(?:BALES|B\s*\/\s*C)$/);
 return m?`${m[1]} ${m[2]} BALES`:null;
}
export async function nonVoidBlnumMatches(read:(path:string)=>Promise<any>,blnum:string,pickupDates:unknown){
 const ranges=pickupMonthRanges(pickupDates),canonical=canonicalBlnum(blnum);
 if(!canonical)throw Error("Invalid BLNUM");
 const found=new Map<string,any>(),hydrated=new Map<string,any>();
 // Search both stored representations; only the unit suffix is interchangeable.
 for(const reference of [canonical,canonical.replace(/ BALES$/," B/C")]){
 const seen=new Set<string>();let complete=false;
 for(let offset=0;offset<100;offset+=5){
 const q=new URLSearchParams({"orders.blnum":reference,"orders.customer_id":"BUNGOMNE",orderBy:"shipper.sched_arrive_early DESC,orders.id DESC",recordLength:"5",recordOffset:String(offset)});
 const rows=extractSearchOrders(await read("/orders/search?"+q));if(!rows||rows.length>5)throw Error("Duplicate lookup returned an incomplete response.");let progress=0;
 for(const row of rows){const id=String((row as any)?.id||"");if(!/^[A-Za-z0-9_-]{1,60}$/.test(id))throw Error("Invalid search result");if(seen.has(id))continue;seen.add(id);progress++;
 let order=hydrated.get(id);if(!order){order=await read("/orders/"+encodeURIComponent(id));if(String(order?.id)!==id)throw Error("Order read-back failed");hydrated.set(id,order)}
 if(order.company_id==="TMS"&&order.customer_id==="BUNGOMNE"&&canonicalBlnum(order.blnum)===canonical){
 const status=String(order.status??"").trim().toUpperCase();
 if(!status)throw Error("Cannot verify the existing order’s status.");
 if(status==="V"||status==="VOID")continue;
 if(!Array.isArray(order.stops))throw Error("Cannot verify the existing order’s pickup stops.");
 const pickups=order.stops.filter((s:any)=>String(s.stop_type).toUpperCase()==="PU");if(!pickups.length)throw Error("Cannot verify the existing order’s pickup stops.");
 const dates=pickups.map((s:any)=>scheduledPickupDay(s.sched_arrive_early||s.sched_arrive_late));
 if(dates.some((date:string)=>ranges.some(range=>date>=range.from&&date<=range.to)))found.set(id,{id,blnum:order.blnum,customerId:order.customer_id,revenue:order.revenue_code_id,status,statusLabel:order.__statusDescr||status,pickupDates:dates});
 }
 }
 if(rows.length<5){complete=true;break}if(!progress)throw Error("Duplicate lookup pagination did not advance.");
 }
 if(!complete)throw Error("Duplicate lookup reached its result limit; review McLeod.");
 }
 return [...found.values()];
}
