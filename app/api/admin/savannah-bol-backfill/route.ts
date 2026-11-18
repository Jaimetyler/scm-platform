import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { staffDatabase } from "@/lib/auth/session";
import { imagingClient } from "@/lib/dray-bols/imaging";
import { bolPlan } from "@/lib/dray-bols/plan";
import { readRun, vendor } from "@/lib/dray/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const batch = new Set([...Array.from({length:51},(_,index)=>String(831402+index).padStart(7,"0")), "0831456"]);
const checked = (order:any) => [true,"Y","true",1,"1"].includes(order.bol_received);
const date = (order:any) => typeof order.bol_recv_date === "string" && order.bol_recv_date.trim() || null;
const hasBol = (images:Awaited<ReturnType<ReturnType<typeof imagingClient>["images"]>>) =>
  images.some(image=>["01","1"].includes(image.documentTypeId) && (!image.companyId || image.companyId === "TMS"));

export async function POST(request: NextRequest) {
  const secret = process.env.SAVANNAH_BOL_BACKFILL_SECRET;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || received.length !== expected.length || !timingSafeEqual(received,expected)) {
    return NextResponse.json({error:"Unauthorized"},{status:401});
  }
  try {
    const {orders,apply} = await request.json();
    if (!Array.isArray(orders) || !orders.length || orders.length > 13 || new Set(orders).size !== orders.length || !orders.every(id=>batch.has(id))) {
      return NextResponse.json({error:"Select up to 13 orders from the approved Savannah Olam batch."},{status:400});
    }
    const db = staffDatabase();
    const {data:runs,error} = await db.from("dray_import_runs").select("id,created_at")
      .gte("created_at","2026-11-17T15:57:00Z").lt("created_at","2026-11-17T15:58:00Z");
    if (error || !runs?.length) throw Error("Could not locate the approved Savannah import run.");
    const candidates = await Promise.all(runs.map(run=>readRun(db,run.id)));
    const matching = candidates.filter(({items})=>{
      const ids = new Set(items.filter(item=>item.order?.profile?.id === "DRAY-SAV-SAVWHSE" &&
        item.order?.invoice?.customerId === "OLAMRITX").map(item=>item.order.order_id));
      return [...batch].every(id=>ids.has(id));
    });
    if (matching.length !== 1) throw Error("The saved run could not be matched to all 52 approved Olam orders.");
    const client = imagingClient();
    const mcleod = vendor();
    const results = await Promise.all(orders.map(async (id:string)=>{
      try {
        const item = matching[0].items.find(item=>item.order.order_id === id);
        const order = await mcleod.read("/orders/"+id);
        bolPlan(item,order);
        if (checked(order) && date(order)) return {id,status:"already received",date:date(order)};
        if (String(order.status).toUpperCase() !== "D") throw Error("Order is not delivered.");
        let indexed = await client.images(id).then(hasBol).catch(()=>false);
        const movement = String(order.curr_movement_id ?? "");
        if (!indexed && /^[A-Za-z0-9_-]{1,60}$/.test(movement)) {
          indexed = await client.movementImages(movement).then(hasBol).catch(()=>false);
        }
        if (!indexed) return {id,status:"BOL image not confirmed"};
        if (apply !== true) return {id,status:"ready",checked:checked(order),date:date(order)};
        if (!checked(order)) {
          await mcleod.write("/orders/updateRow",{__type:"orders",company_id:"TMS",id,bol_received:true});
        }
        const after = await mcleod.read("/orders/"+id);
        return {id,status:checked(after) && date(after) ? "verified" : checked(after) ? "date missing" : "flag not verified",date:date(after)};
      } catch (error) {
        return {id,status:"needs review",error:error instanceof Error ? error.message : "McLeod request failed"};
      }
    }));
    return NextResponse.json({results});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "BOL backfill failed."},{status:502});
  }
}
