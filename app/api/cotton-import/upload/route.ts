import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { parseBungeDispatch } from "@/lib/cotton-import/bunge-dispatch";
import { previewBungeDispatchOrders } from "@/lib/cotton-import/bunge-review";
import { scheduleForPickup, type CottonSchedule } from "@/lib/cotton-import/scheduling";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function upload(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/\\.xlsx?$/i.test(file.name) || file.size > 2_000_000 || file.size === 0)
    return NextResponse.json({ok:false,error:"Upload one Bunge Excel dispatch file under 2 MB."},{status:400});
  const workbook = XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return NextResponse.json({ok:false,error:"Workbook is empty."},{status:400});
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false});
  const dispatch = parseBungeDispatch(rows);
  const {data:locations,error} = await staffDatabase().from("cotton_location_master")
    .select("id,mcleod_code,prev_code,name,timezone,active").limit(5000);
  if (error || !locations) return NextResponse.json({ok:false,error:"Cotton location master unavailable."},{status:503});
  const reviews = previewBungeDispatchOrders(dispatch.orders,
    dispatch.destinationKind as "SAVANNAH"|"DALLAS_2"|"HOUSTON",locations);
  const ids = reviews.flatMap(r => r.preview?.pickupStops.map(s => s.locationId) ?? []);
  const uniqueIds = [...new Set(ids)];
  let scheduleRows: CottonSchedule[] = [];
  if (uniqueIds.length) {
    const response = await staffDatabase().from("cotton_location_schedules")
      .select("location_id,weekday,open_time,close_time,checkin_cutoff,appointment_required,verified,effective_from,effective_to")
      .in("location_id",uniqueIds).limit(5000);
    if (response.error || !response.data)
      return NextResponse.json({ok:false,error:"Location schedules unavailable; cannot validate pickup windows."},{status:503});
    scheduleRows = response.data as CottonSchedule[];
  }
  const scheduledReviews = reviews.map(review => {
    if (!review.preview) return review;
    const windows = review.preview.pickupStops.map(stop => ({
      locationCode: stop.locationCode, originalRtlDate: stop.scheduledDate,
      ...scheduleForPickup(scheduleRows, stop.locationId, stop.scheduledDate)
    }));
    return {...review, pickupWindows: windows,
      reason: windows.some(w => w.status !== "ready")
        ? "Pickup hours or appointment requirements need review: " + windows.filter(w => w.status !== "ready").map(w => w.locationCode + " (" + w.reason + ")").join("; ")
        : "Pickup windows resolved. McLeod duplicate lookup and creation are not enabled."};
  });
  return NextResponse.json({ok:true,previewOnly:true,writesEnabled:false,
    filename:file.name,destination:dispatch.destination,destinationKind:dispatch.destinationKind,
    counts:{orders:dispatch.orders.length,pickupLines:dispatch.orders.reduce((n,o)=>n+o.pickups.length,0),
      blocked:scheduledReviews.filter(r=>r.status==="blocked").length,sourceErrors:dispatch.blocked.length},
    sourceErrors:dispatch.blocked,reviews:scheduledReviews});
}
export const POST=withStaffAccess(async(req:NextRequest)=>{
  try{return await upload(req);}
  catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Unable to parse dispatch"},{status:400});}
});
