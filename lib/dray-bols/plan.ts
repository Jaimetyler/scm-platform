import {identityMatches} from '../dray/mcleod.ts';
import type {BolData} from './pdf.ts';
import {bolEligible} from './eligible.ts';
export function bolPlan(item:any,order:any):BolData{
 if(!bolEligible(item))throw Error('BOL requires a saved verified order and bale count. Reopen the original reports if bale counts are missing.');
 const o=item.order,i=o.invoice;
 if(o.profile.id!=='DRAY-SAV-SAVWHSE'||String(order?.id)!==o.order_id||order.company_id!=='TMS'||String(order.status).toUpperCase()==='V'||!identityMatches(order,i,o.profile))throw Error('McLeod order identity differs from the saved dray.');
 if(String(order.booking_no_sucm||'').trim()!==i.booking||String(order.ordered_by||'').trim()!==i.customerOrder)throw Error('McLeod booking or shipper order differs.');
 for(const n of ['shippingOrder','invoiceDate','customerName','reference','customerOrder','booking','container','chassis','seal'])if(typeof i[n]!=='string'||!i[n].trim()||i[n].length>200)throw Error('Missing BOL field: '+n);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(i.invoiceDate)||!Number.isFinite(Date.parse(i.invoiceDate))||!/^[A-Z]{4}\d{7}$/.test(i.container))throw Error('Invalid BOL date or full container number.');
 return {orderId:o.order_id,shippingOrder:i.shippingOrder,date:i.invoiceDate,shipper:i.customerName,mark:i.reference,bales:item.bol_bales,customerOrder:i.customerOrder,booking:i.booking,container:i.container,chassis:i.chassis,seal:i.seal};
}
