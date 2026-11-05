import {NextRequest,NextResponse} from "next/server";
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
 return NextResponse.json({ok:true,canCreate:false,salesOrder,blnum:review.preview.blnum,
  deliveryLocation:review.preview.deliveryLocation,windows,duplicates:duplicates.map((o:any)=>({id:o.id,blnum:o.blnum})),
  reason:duplicates.length?"Existing McLeod order found; creation blocked.":"No duplicate found. Creation remains disabled until durable audit and write verification are implemented."});
}
export const POST=withStaffAccess(async(req:NextRequest)=>{
 try{return await handler(req);}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Preflight failed"},{status:400});}
});
