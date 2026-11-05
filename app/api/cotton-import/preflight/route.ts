import {NextRequest,NextResponse} from "next/server";
import {createHash} from "node:crypto";
import * as XLSX from "xlsx";
import {withStaffAccess} from "@/lib/auth/guard";
import {staffDatabase} from "@/lib/auth/session";
import {parseBungeDispatch} from "@/lib/cotton-import/bunge-dispatch";
import {previewBungeDispatchOrders} from "@/lib/cotton-import/bunge-review";
import {scheduleForPickup,type CottonSchedule} from "@/lib/cotton-import/scheduling";
import {checkCottonDuplicates} from "@/lib/cotton-import/duplicates";
import type {CottonLocation} from "@/lib/cotton-import/location-resolution";
export const dynamic="force-dynamic";
export const maxDuration=120;
async function handler(req:NextRequest) {
 const form=await req.formData(),file=form.get("file"),salesOrder=String(form.get("salesOrder")??"").trim();
 if(!(file instanceof File)||!/^.+\.xlsx?$/i.test(file.name)||file.size===0||file.size>2_000_000||!/^\d{5,}$/.test(salesOrder))
  return NextResponse.json({ok:false,error:"Select one sales order and upload its original Excel dispatch (under 2 MB)."},{status:400});
 const book=XLSX.read(await file.arrayBuffer(),{type:"array",raw:false});
 const sheet=book.Sheets[book.SheetNames[0]];
 if(!sheet)throw new Error("Workbook has no first worksheet.");
 const dispatch=parseBungeDispatch(XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false}));
 const matches=dispatch.orders.filter(o=>o.salesOrder===salesOrder);
 if(matches.length!==1)throw new Error("Selected sales order must appear exactly once in the dispatch.");
 const db=staffDatabase();
 const loc=await db.from("cotton_location_master").select("id,mcleod_code,prev_code,name,timezone,active").limit(5000);
 if(loc.error||!loc.data)throw new Error("Location master unavailable.");
 const review=previewBungeDispatchOrders(matches,dispatch.destinationKind as "SAVANNAH"|"DALLAS_2"|"HOUSTON",loc.data as CottonLocation[])[0];
 if(!review.preview)throw new Error("Selected order blocked: "+review.reason);
 const ids=review.preview.pickupStops.map(s=>s.locationId);
 const schedules=await db.from("cotton_location_schedules")
  .select("location_id,weekday,open_time,close_time,checkin_cutoff,appointment_required,verified,effective_from,effective_to")
  .in("location_id",ids).limit(5000);
 if(schedules.error||!schedules.data)throw new Error("Pickup schedule unavailable.");
 const windows=review.preview.pickupStops.map(s=>({locationCode:s.locationCode,originalRtlDate:s.scheduledDate,
  ...scheduleForPickup(schedules.data as CottonSchedule[],s.locationId,s.scheduledDate,s.locationCode)}));
 if(windows.some(w=>w.status!=="ready"))
  return NextResponse.json({ok:true,canCreate:false,salesOrder,reason:"Pickup schedule requires review.",windows});
 const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL;
 const token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
 if(!base||!token)throw new Error("McLeod read-only connection is not configured.");
 const read=async(path:string)=>{
  if(!/^\/orders(?:\/search\?|\/[A-Za-z0-9_-]+$)/.test(path))throw new Error("Unsupported McLeod lookup.");
  const response=await fetch(base.replace(/\/$/,"")+path,{headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error("McLeod lookup failed HTTP "+response.status);
  return response.json();
 };
 const duplicates=await checkCottonDuplicates(read,{customerId:review.preview.customerId,revenueCode:review.preview.revenueCode,blnum:review.preview.blnum,salesOrder});
 const originalPickups=matches[0].pickups.map(line=>({
  row:line.row,mark:line.mark,salesOrder:line.salesOrder,bales:line.bales,
  warehouse:line.warehouse,usdaWarehouseCode:line.usdaWarehouseCode,originalRtl:line.rtl
 }));
 const sourceHash=createHash("sha256").update(JSON.stringify({
  salesOrder,blnum:review.preview.blnum,destination:review.preview.deliveryLocation,originalPickups
 })).digest("hex");
 const {data:existing,error:existingError}=await db.from("cotton_bunge_import_orders")
  .select("id,source_hash,status,mcleod_order_id").eq("customer_id","BUNGOMNE")
  .eq("revenue_code","MAIN").eq("blnum",review.preview.blnum).maybeSingle();
 if(existingError)throw new Error("Import audit ledger is unavailable.");
 if(existing && existing.source_hash!==sourceHash)
  throw new Error("Existing audit record conflicts with this dispatch. Creation blocked.");
 if(!existing && duplicates.length===0) {
  const inserted=await db.from("cotton_bunge_import_orders").insert({
   source_hash:sourceHash,sales_order:salesOrder,blnum:review.preview.blnum,
   customer_id:review.preview.customerId,revenue_code:review.preview.revenueCode,
   destination_code:review.preview.deliveryLocation,source_filename:file.name,
   original_pickups:originalPickups,status:"previewed"
  });
  if(inserted.error)throw new Error("Could not save original RTL audit record. Creation blocked.");
 }
 return NextResponse.json({ok:true,canCreate:false,salesOrder,blnum:review.preview.blnum,
  auditStatus:existing?.status??(duplicates.length?"duplicate_not_saved":"previewed"),
  auditId:existing?.id??null,
  deliveryLocation:review.preview.deliveryLocation,windows,duplicates:duplicates.map((o:any)=>({id:o.id,blnum:o.blnum})),
  reason:duplicates.length?"Existing McLeod order found; creation blocked.":"No duplicate found. Creation remains disabled until durable audit and write verification are implemented."});
}
export const POST=withStaffAccess(async(req:NextRequest)=>{
 try{return await handler(req);}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Preflight failed"},{status:400});}
});
