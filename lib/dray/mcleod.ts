import * as ecotton from "../ecotton/mcleod.ts";
import { normalize, type DrayInvoice } from "./model.ts";
import type { Invoice, Profile } from "../ecotton/model.ts";
import { extractSearchOrders } from "../mcleod/inbound/search-response.ts";

function approved(i: Invoice): DrayInvoice {
  const d = i as DrayInvoice;
  if (!Array.isArray(d.inputErrors) || d.inputErrors.length || !d.destination || d.carrierCents == null || d.carrierCents <= 0)
    throw new Error("Dray source, customer, port and carrier pay must be resolved before processing.");
  if (!d.customerOrder) throw new Error("Shipper's Order# is missing; refresh this import from the original report.");
  return d;
}
function routeMatches(order: any, d: DrayInvoice, p: Profile) {
  return Array.isArray(order?.stops) && order.stops.length === 2 &&
    order.stops.filter(s => normalize(s.stop_type) === "PU" && normalize(s.location_id) === p.location).length === 1 &&
    order.stops.filter(s => normalize(s.stop_type) === "SO" && normalize(s.location_id) === d.destination).length === 1;
}
function projection(order: any, d: DrayInvoice, p: Profile) {
  return {...order, planning_comment:(d.cents/100).toFixed(2), rate:0, ordered_by:p.orderedBy,
    stops:order.stops?.map(s=>({...s,location_id:p.location})),
    movements:order.movements?.map(m=>({...m,override_paye_rate:0,override_pay_rate:0,override_pay_amt:0}))};
}
export function buildPayload(i: Invoice, p: Profile) {
  const d = approved(i), payload = ecotton.buildPayload(i,p);
  return {...payload,planning_comment:d.fileNumber,ordered_by:d.customerOrder,
    booking_no_sucm:d.booking,rate:d.baseCents/100,total_charge:d.cents/100,
    stops:payload.stops.map(s=>({...s,location_id:s.stop_type === "PU" ? p.location : d.destination})),
    movements:payload.movements.map(m=>({...m,override_paye_rate:d.carrierCents!/100,override_pay_rate:d.carrierCents!/100,override_pay_amt:d.carrierCents!/100}))};
}
export function identityMatches(order: any, i: Invoice, p: Profile) {
  const d = approved(i);
  return routeMatches(order,d,p) && ecotton.identityMatches(projection(order,d,p),i,p);
}
export function verifyRatedOrder(order: any, i: Invoice, p: Profile): string[] {
  const d = approved(i), errors = ecotton.verifyRatedOrder(projection(order,d,p),i,p);
  if (!routeMatches(order,d,p)) errors.push("Warehouse / port route differs");
  if (String(order.planning_comment ?? "").trim() !== d.fileNumber) errors.push("File number differs from source");
  if (String(order.ordered_by ?? "").trim() !== d.customerOrder) errors.push("Ordered By differs from source");
  if (String(order.booking_no_sucm ?? "").trim() !== d.booking) errors.push("Booking number differs from source");
  if (order.rate == null || String(order.rate).trim() === "" || Math.round(Number(order.rate)*100) !== d.baseCents) errors.push("Base billing rate differs");
  if (!Array.isArray(order.movements) || order.movements.length !== 1 ||
    order.movements.some(m=>[m.override_paye_rate,m.override_pay_rate,m.override_pay_amt].some(v=>v == null || String(v).trim() === "" || !Number.isFinite(Number(v)) || Math.round(Number(v)*100) !== d.carrierCents)))
    errors.push("Carrier payment settings differ from FirstStar");
  return errors;
}
export async function findDuplicates(read: ecotton.Reader, i: Invoice, p: Profile) {
  const found = new Map<string,any>(), seen = new Set<string>();
  for (let offset=0;offset<100;offset+=5) {
    const q = new URLSearchParams({"orders.blnum":i.reference,"orders.order_type_id":p.orderType,"orders.revenue_code_id":p.revenue,recordLength:"5",recordOffset:String(offset)});
    const rows = extractSearchOrders(await read("/orders/search?"+q));
    if (!Array.isArray(rows) || rows.length > 5) throw new Error("Unrecognized duplicate search response");
    let progress=0;
    for (const r of rows) {
      const id=String((r as any)?.id??"");
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw new Error("Invalid duplicate order ID");
      if (seen.has(id)) continue; seen.add(id); progress++;
      const o=await read("/orders/"+encodeURIComponent(id));
      if (String(o?.id)!==id) throw new Error("Duplicate hydration failed");
      if (normalize(o.blnum)!==normalize(i.reference)) continue;
      if (!Array.isArray(o.stops)) throw new Error("Duplicate stop details unavailable");
      if (!normalize(o.consignee_refno)) throw new Error("Existing mark has no container reference; review before creating another order");
      // The same mark may ship in multiple containers: compare full container too.
      if (normalize(o.consignee_refno)===normalize(i.mark)) found.set(id,o);
    }
    if (rows.length<5) return [...found.values()];
    if (!progress) throw new Error("Duplicate search did not advance");
  }
  throw new Error("Incomplete duplicate search; creation blocked");
}
export function movementUpdatePayload(order: any, i: Invoice, p: Profile, expectedId: string, allowReferenceRepair = false) {
  const d=approved(i);
  const nonPayment=verifyRatedOrder(order,i,p).filter(e=>!["Movement payee or zero-payment settings differ from approved profile","Carrier payment settings differ from FirstStar","McLeod order total differs from source invoice", ...(allowReferenceRepair ? ["Ordered By differs from source","Booking number differs from source"] : [])].includes(e));
  if (nonPayment.length || String(order.id)!==expectedId || normalize(order.status)!=="A" || order.stops.some(s=>normalize(s.status)!=="A" || s.actual_arrival || s.actual_departure)) throw new Error("Dray movement setup blocked: " + (nonPayment.join("; ") || "order changed or progressed"));
  if (order.movements?.length!==1 || !order.movements[0].id) throw new Error("One saved movement is required");
  const m=order.movements[0];
  for (const field of ["override_payee_id","carrier_id","vendor_id"]) if (m[field] && normalize(m[field])!==p.payee) throw new Error("Refusing to overwrite another carrier");
  for (const field of ["override_paye_rate","override_pay_rate","override_pay_amt"]) if (m[field]!=null && String(m[field]).trim()!=="" && Number(m[field])!==0 && Math.round(Number(m[field])*100)!==d.carrierCents) throw new Error("Refusing to overwrite a different carrier payment");
  if (m.override_type && normalize(m.override_type)!=="F" || m.override_units!=null && String(m.override_units).trim()!=="" && Number(m.override_units)!==1) throw new Error("Movement payment method differs");
  return {__type:"movement",company_id:"TMS",id:m.id,override_payee_id:p.payee,override_type:"F",override_units:1,override_paye_rate:d.carrierCents/100,override_pay_rate:d.carrierCents/100,override_pay_amt:d.carrierCents/100};
}
