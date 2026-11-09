import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { parseBreakMarks } from "@/lib/warehouse/break-marks";
export const runtime="nodejs";
export const POST=withStaffAccess(async(req:NextRequest)=>{
 try {
  const body=await req.json();
  const site=CHECKIN_SITES.find(s=>s.terminal===body.terminal&&s.siteCode===body.siteCode&&s.materials.includes("cotton"));
  const customer=String(body.customer??"").trim().toUpperCase(),location=String(body.warehouseLocation??"").trim().toUpperCase();
  if(!site || !customer || customer.length>200 || location.length>120 || !["preview","import"].includes(body.action))
   return NextResponse.json({ok:false,error:"Choose a cotton warehouse and enter the customer."},{status:400});
  if(body.quantityColumn && !["bales","pasadena","mckinney"].includes(body.quantityColumn))
   return NextResponse.json({ok:false,error:"Choose a valid quantity column."},{status:400});
  const preview=parseBreakMarks(body.text,body.quantityColumn);
  const db=staffDatabase();
  if(body.action==="preview") {
   const {data,error}=await db.from("warehouse_inventory_lots").select("mark,customer,source_type,shipping_order,original_bales,current_bales,inventory_status")
    .eq("terminal",site.terminal).eq("site_code",site.siteCode).in("mark",preview.rows.map(r=>r.mark)).limit(2000);
   if(error)throw Error("Could not check existing inventory. Try preview again.");
   return NextResponse.json({ok:true,...preview,existingMarks:[...new Set((data??[]).filter(r=>r.current_bales>0&&r.inventory_status!=="closed" ||
    r.source_type==="break"&&r.customer?.trim().toUpperCase()===customer).map(r=>r.mark))]});
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.requestId??"")))
   return NextResponse.json({ok:false,error:"Preview these marks before importing."},{status:400});
  const {data,error}=await db.rpc("import_warehouse_break_marks",{p_request:body.requestId,p_terminal:site.terminal,p_site:site.siteCode,p_site_name:site.siteName,
   p_customer:customer,p_location:location,p_rows:preview.rows,p_actor:staffActor(req)});
  if(error)return NextResponse.json({ok:false,error:error.message},{status:error.code==="22023"?400:409});
  return NextResponse.json({ok:true,...data});
 }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not import break marks."},{status:400});}
});
