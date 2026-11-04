import {extractSearchOrders} from "@/lib/mcleod/inbound/search-response";
export async function availableBlnumMatches(read:(path:string)=>Promise<any>,blnum:string){
 if(!/^[A-Za-z0-9-]{1,30} [1-9]\d{0,6} BALES$/.test(blnum))throw Error("Invalid BLNUM");
 const found=new Map<string,any>(),seen=new Set<string>();
 for(let offset=0;offset<100;offset+=5){
 const q=new URLSearchParams({"orders.blnum":blnum,"orders.status":"A","orders.customer_id":"BUNGOMNE",recordLength:"5",recordOffset:String(offset)});
 const rows=extractSearchOrders(await read("/orders/search?"+q));if(!rows||rows.length>5)throw Error("Duplicate lookup returned an incomplete response.");let progress=0;
 for(const row of rows){const id=String((row as any)?.id||"");if(!/^[A-Za-z0-9_-]{1,60}$/.test(id))throw Error("Invalid search result");if(seen.has(id))continue;seen.add(id);progress++;
 const order=await read("/orders/"+encodeURIComponent(id));if(String(order?.id)!==id)throw Error("Order read-back failed");
 if(order.company_id==="TMS"&&String(order.status).toUpperCase()==="A"&&order.customer_id==="BUNGOMNE"&&String(order.blnum).trim().toUpperCase()===blnum.toUpperCase())found.set(id,{id,blnum:order.blnum,customerId:order.customer_id,revenue:order.revenue_code_id});
 }
 if(rows.length<5)return [...found.values()];if(!progress)throw Error("Duplicate lookup pagination did not advance.");
 }
 throw Error("Duplicate lookup reached its result limit; review McLeod.");
}
