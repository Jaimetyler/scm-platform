import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { staffActor, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { imagingClient, receiptVisible } from "@/lib/dray-bols/imaging";
import { bolPlan } from "@/lib/dray-bols/plan";
import { readRun, vendor } from "@/lib/dray/server";
import { findSavannahInterchangeBookings, readSavannahInterchangePdfs } from "@/lib/sharepoint/e2open-documents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// McLeod displays 05-Interchange with ImagingService type ID 5.
const documentType = "5";

export const POST = withStaffAccess(async request => {
  try {
    const body = await request.json();
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!uuid.test(body.runId) || !uuid.test(body.rowId) || body.confirmed !== true) {
      throw Error("Confirm the selected Savannah interchange upload.");
    }
    if (process.env.DRAY_IMPORT_WRITES_ENABLED !== "true" || process.env.MCLEOD_SYNC_ENABLED !== "true") {
      throw Error("McLeod uploads are disabled.");
    }
    const db = staffDatabase();
    const {items} = await readRun(db, body.runId);
    const item = items.find(row => row.order_id === body.rowId);
    if (!item || item.order.profile.id !== "DRAY-SAV-SAVWHSE" || item.order.invoice.customerId !== "OLAMRITX") {
      throw Error("Select an imported Savannah Olam order.");
    }
    const order = await vendor(true).read("/orders/" + item.order.order_id);
    const plan = bolPlan(item, order);
    const matches = await findSavannahInterchangeBookings(plan.container, plan.booking, true);
    if (matches.length !== 1 || !matches[0].inbound || !matches[0].outbound || matches[0].booking !== body.booking) {
      throw Error("The confirmed interchange pair could not be matched again in SharePoint.");
    }
    const files = (await readSavannahInterchangePdfs(matches[0].booking, plan.container)).map(file => ({
      ...file, digest: createHash("sha256").update(file.bytes).digest("hex"),
    }));
    const client = imagingClient();
    const [images, attempts] = await Promise.all([
      client.images(plan.orderId),
      db.from("dray_bol_images").select("pdf_hash,status,receipt").eq("mcleod_order", plan.orderId).eq("document_type", documentType),
    ]);
    if (attempts.error) throw Error("Interchange upload history unavailable.");
    if (images.some(image => ["5", "05"].includes(image.documentTypeId) &&
      !attempts.data.some(attempt => attempt.receipt === image.id))) {
      return NextResponse.json({ok:true,message:"An existing interchange is in McLeod Images. Review it before uploading this pair."});
    }
    if (attempts.data.some(attempt => !files.some(file => file.digest === attempt.pdf_hash))) {
      throw Error("The SharePoint PDFs changed after an upload attempt. Review the order in McLeod.");
    }
    const messages: string[] = [];
    for (const {direction, bytes, digest} of files) {
      const prior = attempts.data.find(attempt => attempt.pdf_hash === digest);
      if (prior) {
        messages.push(`${direction}: ${prior.receipt && receiptVisible(images, prior.receipt, documentType) || prior.status === "verified"
          ? "already indexed" : prior.status === "staged" ? "accepted, indexing pending" : "previous attempt needs review"}`);
        continue;
      }
      const {data:claim,error} = await db.from("dray_bol_images").insert({
        order_id:item.order_id, mcleod_order:plan.orderId, pdf_hash:digest,
        document_type:documentType, status:"sending", actor:staffActor(request),
      }).select("id").single();
      if (error || !claim) {
        messages.push(`${direction}: ${error?.code === "23505" ? "upload already attempted" : "could not reserve upload"}`);
        continue;
      }
      let receipt: string | null = null;
      let status = "uncertain";
      try {
        receipt = await client.upload(plan.orderId, documentType, bytes);
        status = "staged";
        try {
          if (receiptVisible(await client.images(plan.orderId), receipt, documentType)) status = "verified";
        } catch {
          // Keep the accepted receipt when the imaging index is unavailable.
        }
      } catch {
        // Preserve the claim until this attempt can be checked in McLeod.
      }
      const saved = await db.from("dray_bol_images").update({status,receipt,updated_at:new Date().toISOString()}).eq("id",claim.id);
      messages.push(`${direction}: ${saved.error ? "outcome could not be recorded" :
        status === "verified" ? "indexed" : status === "staged" ? "accepted, indexing pending" : "upload outcome uncertain"}`);
    }
    return NextResponse.json({ok:true,message:messages.join(" · ")});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error ? error.message : "Interchange upload failed."},{status:400});
  }
});
