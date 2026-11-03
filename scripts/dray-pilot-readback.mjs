// Bounded read-only diagnostic. Uses deployment credentials in place; never logs them.
import {createClient} from "@supabase/supabase-js";
import {verifyRatedOrder} from "../lib/dray/mcleod.ts";
const id=process.argv[2];
if(!/^\d{7}$/.test(id||""))throw Error("Pass exactly one McLeod pilot order number");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:row,error}=await db.from("dray_import_orders").select("*").eq("order_id",id).single();
if(error||!row)throw Error("Pilot import receipt unavailable");
const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL;
const token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
const response=await fetch(base.replace(/\/$/,"")+"/orders/"+id,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error("Pilot read-back HTTP "+response.status);
const o=await response.json();
const pick=(obj,fields)=>Object.fromEntries(fields.map(f=>[f,obj?.[f]??null]));
console.log("DRAY_PILOT_READBACK "+JSON.stringify({errors:verifyRatedOrder(o,row.invoice,row.profile),
 order:pick(o,["id","status","customer_id","blnum","consignee_refno","planning_comment","ordered_by","booking_no_sucm","rate_type","rate_units","rate","total_charge","collection_method","commodity_id","equipment_type_id","order_mode","curr_movement_id"]),
 stops:o.stops?.map(s=>pick(s,["id","stop_type","status","location_id","actual_arrival","actual_departure"])),
 movements:o.movements?.map(m=>pick(m,["id","status","override_payee_id","carrier_id","override_type","override_units","override_paye_rate","override_pay_rate","override_pay_amt"])),
 charges:o.otherCharges??o.other_charges}));

if(process.argv.includes("--reconcile")){
 const errors=verifyRatedOrder(o,row.invoice,row.profile);
 if(errors.length||String(o.id)!==row.order_id||o.status!=="A"||o.stops.some(s=>s.status!=="A"||s.actual_arrival||s.actual_departure))throw Error("Read-only reconciliation remains blocked: "+errors.join("; "));
 if(!["rating_uncertain","blocked"].includes(row.status))throw Error("Pilot is not awaiting reconciliation");
 const {data,error}=await db.rpc("transition_dray_import",{p_id:row.id,p_version:row.version,p_from:row.status,p_to:"verified",p_order:id,p_note:"Read-only reconciliation verified references, carrier and exact billing; no vendor retry or delivery",p_actor:"User-authorized pilot read-back"});
 if(error||!data?.[0])throw Error("Pilot verification state could not be saved");
 console.log("DRAY_PILOT_RECONCILED verified; no McLeod writes performed");
}
