import { extractSearchOrders } from "../mcleod/inbound/search-response.ts";
export type McLeodReader = (path:string)=>Promise<unknown>;
export type CottonDuplicateKey = {customerId:string; revenueCode:string; blnum:string; salesOrder:string};
/** Fail closed on ambiguous or incomplete McLeod responses; never assume a missing search page means no duplicates. */
export async function checkCottonDuplicates(read:McLeodReader, key:CottonDuplicateKey) {
 const found=new Map<string,unknown>(),seen=new Set<string>();
 for(let offset=0;offset<100;offset+=5) {
  const q=new URLSearchParams({"orders.blnum":key.blnum,"orders.revenue_code_id":key.revenueCode,recordLength:"5",recordOffset:String(offset)});
  const rows=extractSearchOrders(await read("/orders/search?"+q));
  if(!Array.isArray(rows)||rows.length>5)throw new Error("McLeod duplicate lookup returned an invalid page.");
  let advanced=false;
  for(const row of rows) {
   const id=String((row as {id?:unknown})?.id??"");
   if(!/^[A-Za-z0-9_-]{1,60}$/.test(id))throw new Error("McLeod duplicate lookup returned an invalid order ID.");
   if(seen.has(id))continue;
   advanced=true;seen.add(id);
   const order=await read("/orders/"+encodeURIComponent(id)) as Record<string,unknown>;
   if(String(order?.id)!==id)throw new Error("McLeod duplicate read-back failed.");
   const norm=(v:unknown)=>String(v??"").trim().toUpperCase();
   if(norm(order.blnum)===norm(key.blnum) && norm(order.customer_id)===norm(key.customerId) && norm(order.revenue_code_id)===norm(key.revenueCode))
    found.set(id,order);
  }
  if(rows.length<5)return [...found.values()];
  if(!advanced)throw new Error("McLeod duplicate pagination stalled.");
 }
 throw new Error("McLeod duplicate search incomplete.");
}
