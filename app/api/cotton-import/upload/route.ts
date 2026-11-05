import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { terminalDeliveryCode } from "@/lib/bunge/destinations";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { parseBungeDispatch } from "@/lib/cotton-import/bunge-dispatch";
import { previewBungeDispatchOrders } from "@/lib/cotton-import/bunge-review";
import { requestedEquipment, reviewPickupEquipment, type PickupEquipmentPolicy } from "@/lib/cotton-import/equipment";
import { scheduleForPickup, type CottonSchedule } from "@/lib/cotton-import/scheduling";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function upload(req: NextRequest) {
  const form = await req.formData();
  const destination = terminalDeliveryCode("houston", form.get("destination"));
  if (destination !== "SUPPBAT1" && destination !== "SUPPPAT1") throw new Error("Choose a Houston delivery location.");
  const file = form.get("file");
  const equipment = requestedEquipment(form.get("equipment"));
  if (!(file instanceof File))
    return NextResponse.json({ok:false,error:"No Excel file received. Choose a dispatch workbook."},{status:400});
  if (!/\.xlsx?$/i.test(file.name))
    return NextResponse.json({ok:false,error:"Unsupported file type. Choose an .xlsx or .xls workbook."},{status:400});
  if (file.size === 0 || file.size > 2_000_000)
    return NextResponse.json({ok:false,error:"Excel workbook must be nonempty and under 2 MB."},{status:400});
  const workbook = XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return NextResponse.json({ok:false,error:"Workbook is empty."},{status:400});
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false});
  const dispatch = parseBungeDispatch(rows);
  if (dispatch.destinationKind !== "HOUSTON") throw new Error("Upload a Houston Bunge dispatch.");
  const {data:locations,error} = await staffDatabase().from("cotton_location_master")
    .select("id,mcleod_code,prev_code,name,timezone,active").limit(5000);
  if (error || !locations) return NextResponse.json({ok:false,error:"Cotton location master unavailable."},{status:503});
  const reviews = previewBungeDispatchOrders(dispatch.orders,
    dispatch.destinationKind,locations,destination);
  const ids = reviews.flatMap(r => r.preview?.pickupStops.map(s => s.locationId) ?? []);
  const uniqueIds = [...new Set(ids)];
  let scheduleRows: CottonSchedule[] = [];
  let equipmentRows: PickupEquipmentPolicy[] = [];
  if (uniqueIds.length) {
    const [response, equipmentResponse] = await Promise.all([staffDatabase().from("cotton_location_schedules")
      .select("location_id,weekday,open_time,close_time,checkin_cutoff,appointment_required,verified,effective_from,effective_to")
      .in("location_id",uniqueIds).limit(5000),
      staffDatabase().from("cotton_location_equipment").select("location_id,accepted_equipment,effective_date,verified")
        .in("location_id",uniqueIds).limit(5000),
    ]);
    if (response.error || !response.data)
      return NextResponse.json({ok:false,error:"Location schedules unavailable; cannot validate pickup windows."},{status:503});
    if (equipmentResponse.error || !equipmentResponse.data) throw new Error("Location equipment rules unavailable.");
    scheduleRows = response.data as CottonSchedule[];
    equipmentRows = equipmentResponse.data;
  }
  const policyByLocation = new Map<string, {status:string; effective_from:string|null; effective_to:string|null; rules:unknown[]}[]>();
  if (uniqueIds.length) {
    const policies = await staffDatabase().from("cotton_location_policy_versions")
      .select("id,location_id,status,effective_from,effective_to")
      .in("location_id",uniqueIds).limit(5000);
    if (policies.error || !policies.data)
      return NextResponse.json({ok:false,error:"Location policies unavailable; preview blocked."},{status:503});
    const versionIds = policies.data.map(p=>p.id);
    const rules = versionIds.length
      ? await staffDatabase().from("cotton_location_policy_rules")
          .select("policy_version_id,rule_kind,fee_type,amount,grace_days,grace_unit,avoidable_fee,conditions,notes")
          .in("policy_version_id",versionIds).limit(5000)
      : {data:[],error:null};
    if (rules.error || !rules.data)
      return NextResponse.json({ok:false,error:"Location policy rules unavailable; preview blocked."},{status:503});
    for (const p of policies.data) {
      const list = policyByLocation.get(p.location_id) ?? [];
      list.push({status:p.status,effective_from:p.effective_from,effective_to:p.effective_to,
        rules:rules.data.filter(r=>r.policy_version_id===p.id)});
      policyByLocation.set(p.location_id,list);
    }
  }
  const scheduledReviews = reviews.map(review => {
    if (!review.preview) return review;
    const windows = review.preview.pickupStops.map(stop => ({
      locationCode: stop.locationCode, originalRtlDate: stop.scheduledDate,
      ...scheduleForPickup(scheduleRows, stop.locationId, stop.scheduledDate, stop.locationCode)
    }));
    const pickupPolicies = review.preview.pickupStops.map(stop => ({locationCode:stop.locationCode, originalRtlDate:stop.scheduledDate, versions:(policyByLocation.get(stop.locationId) ?? []).filter(p => (!p.effective_from || p.effective_from <= stop.scheduledDate) && (!p.effective_to || p.effective_to >= stop.scheduledDate))}));
    return {...review, pickupWindows: windows, pickupPolicies,
      equipment: reviewPickupEquipment(review.preview.pickupStops, equipmentRows, equipment),
      reason: windows.some(w => w.status !== "ready")
        ? "Pickup hours or appointment requirements need review: " + windows.filter(w => w.status !== "ready").map(w => w.locationCode + " (" + w.reason + ")").join("; ")
        : "Pickup windows resolved. Run single-order McLeod preflight."};
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
