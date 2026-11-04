import {extractSearchOrders} from "@/lib/mcleod/inbound/search-response";
import {pickupMonthRanges,scheduledPickupDay} from "./duplicate-window";
export async function nonVoidBlnumMatches(read:(path:string)=>Promise<any>,blnum:string,pickupDates:unknown){
 const ranges=pickupMonthRanges(pickupDates);
 if(!/^[A-Za-z0-9-]{1,30} [1-9]\d{0,6} BALES$/.test(blnum))throw Error("Invalid BLNUM");
 const found=new Map<string,any>(),seen=new Set<string>();
 for(let offset=0;offset<100;offset+=5){
 const q=new URLSearchParams({"orders.blnum":blnum,"orders.customer_id":"BUNGOMNE",orderBy:"shipper.sched_arrive_early DESC,orders.id DESC",recordLength:"5",recordOffset:String(offset)});
 const rows=extractSearchOrders(await read("/orders/search?"+q));if(!rows||rows.length>5)throw Error("Duplicate lookup returned an incomplete response.");let progress=0;
 for(const row of rows){const id=String((row as any)?.id||"");if(!/^[A-Za-z0-9_-]{1,60}$/.test(id))throw Error("Invalid search result");if(seen.has(id))continue;seen.add(id);progress++;
 const order=await read("/orders/"+encodeURIComponent(id));if(String(order?.id)!==id)throw Error("Order read-back failed");
 if(order.company_id==="TMS"&&order.customer_id==="BUNGOMNE"&&String(order.blnum).trim().toUpperCase()===blnum.toUpperCase()){
 const status=String(order.status??"").trim().toUpperCase();
 if(!status)throw Error("Cannot verify the existing order’s status.");
 if(status==="V"||status==="VOID")continue;
 if(!Array.isArray(order.stops))throw Error("Cannot verify the existing order’s pickup stops.");
 const pickups=order.stops.filter((s:any)=>String(s.stop_type).toUpperCase()==="PU");if(!pickups.length)throw Error("Cannot verify the existing order’s pickup stops.");
 const dates=pickups.map((s:any)=>scheduledPickupDay(s.sched_arrive_early||s.sched_arrive_late));
 if(dates.some((date:string)=>ranges.some(range=>date>=range.from&&date<=range.to)))found.set(id,{id,blnum:order.blnum,customerId:order.customer_id,revenue:order.revenue_code_id,status,statusLabel:order.__statusDescr||status,pickupDates:dates});
 }
 }
 if(rows.length<5)return [...found.values()];if(!progress)throw Error("Duplicate lookup pagination did not advance.");
 }
 throw Error("Duplicate lookup reached its result limit; review McLeod.");
}
