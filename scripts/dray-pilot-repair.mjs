// Explicit one-order operational repair; never wired into the default build command.
import {createClient} from "@supabase/supabase-js";
import {repairCreatedInvoice} from "../lib/dray/engine.ts";
import {verifyRatedOrder} from "../lib/dray/mcleod.ts";
const id=process.argv[2];
if(id!=="0829214")throw Error("This reviewed repair is restricted to pilot 0829214");
if(process.env.DRAY_IMPORT_WRITES_ENABLED!=="true" || process.env.MCLEOD_SYNC_ENABLED!=="true")throw Error("Dray writes are disabled");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:saved,error}=await db.from("dray_import_orders").select("*").eq("order_id",id).single();
let row=saved;
if(error||!row||!["blocked","rating_uncertain"].includes(row.status))throw Error("Pilot is not awaiting a reviewed repair");
const {count,error:eventError}=await db.from("dray_import_events").select("id",{count:"exact",head:true}).eq("order_id",row.id).eq("to_state","created").eq("order_number",id);
if(eventError||!count)throw Error("Importer creation receipt is not established");
async function transition(r,from,to,order,note){
 const {data,error}=await db.rpc("transition_dray_import",{p_id:r.id,p_version:r.version,p_from:from,p_to:to,p_order:order,p_note:note,p_actor:"User-authorized pilot repair 0829214"});
 if(error||!data?.[0])throw Error("Repair claim/state save failed; no retries");
 return data[0];
}
const store={claim:async(recordId,from,to,note)=>recordId===row.id?transition(row,from,to,row.order_id,note):null,finish:async(r,to,order,note)=>transition(r,r.status,to,order,note)};
const base=process.env.MCLEOD_BASE_URL.replace(/\/$/,"");
async function request(path,method,body){
 if(method!=="GET" && !["/orders/updateRow","/movement/update","/carrierDispatch/setPay/650801?method=F&units=1&rate=200&carrierPay=200"].includes(path))throw Error("Unsupported pilot operation");
 const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${process.env.MCLEOD_AUTH_TOKEN}`,Accept:path.startsWith("/carrierDispatch/")?"text/plain, application/json":"application/json","Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error("Pilot HTTP "+response.status);
 const text=await response.text();return path.startsWith("/carrierDispatch/")?{raw:text}:JSON.parse(text);
}
if(row.status==="rating_uncertain"){
 if(!process.argv.includes("--complete-reviewed-pay") || !row.note.includes("Pilot HTTP 406"))throw Error("Uncertain writes cannot be retried");
 const before=await request("/orders/"+id,"GET");const errors=verifyRatedOrder(before,row.invoice,row.profile),m=before.movements?.[0];
 if(errors.length!==1 || errors[0]!=="Carrier payment settings differ from FirstStar" || before.status!=="A" || before.stops.some(s=>s.status!=="A"||s.actual_arrival||s.actual_departure) || m?.id!=="650801" || m.override_pay_rate!=null || Number(m.override_paye_rate)!==200 || Number(m.override_pay_amt)!==200)
   throw Error("Saved order differs from reviewed missing-supplemental-rate snapshot");
 row=await transition(row,"rating_uncertain","blocked",id,"Read-only inspection confirmed HTTP 406 left only supplemental pay rate missing; existing references, payee, $200 pay and $485 billing match");
}
await repairCreatedInvoice(row,store,{read:path=>request(path,"GET"),write:(path,body)=>request(path,path.startsWith("/carrierDispatch/")?"POST":"PUT",body)});
console.log("DRAY_PILOT_REPAIR completed; consult persisted state/read-back for result");
