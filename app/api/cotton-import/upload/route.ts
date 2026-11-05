import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { parseBungeDispatch } from "@/lib/cotton-import/bunge-dispatch";
import { previewBungeDispatchOrders } from "@/lib/cotton-import/bunge-review";

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
  return NextResponse.json({ok:true,previewOnly:true,writesEnabled:false,
    filename:file.name,destination:dispatch.destination,destinationKind:dispatch.destinationKind,
    counts:{orders:dispatch.orders.length,pickupLines:dispatch.orders.reduce((n,o)=>n+o.pickups.length,0),
      blocked:reviews.filter(r=>r.status==="blocked").length,sourceErrors:dispatch.blocked.length},
    sourceErrors:dispatch.blocked,reviews});
}
export const POST=withStaffAccess(async(req:NextRequest)=>{
  try{return await upload(req);}
  catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Unable to parse dispatch"},{status:400});}
});
