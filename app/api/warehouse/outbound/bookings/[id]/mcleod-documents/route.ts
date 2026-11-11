import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { staffActor, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { imagingClient } from "@/lib/dray-bols/imaging";
import { connectSharePoint } from "@/lib/sharepoint/graph";
import { isSavannahE2openBooking } from "@/lib/warehouse/outbound/e2open-customer";
import { findLdcOrder } from "@/lib/warehouse/outbound/e2open-mcleod";

export const runtime = "nodejs";
export const maxDuration = 300;

function imagingCode(id: string) {
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, "") : trimmed;
}

function imageTypeMatches(image: { documentTypeId: string }, type: string) {
  return imagingCode(image.documentTypeId) === imagingCode(type);
}

function receiptVisible(images: { id: string; documentTypeId: string; companyId?: string }[], receipt: string, type: string) {
  return images.some(image => image.id === receipt && imageTypeMatches(image, type) && image.companyId === "TMS");
}

export const POST = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const { terminal, siteCode, retryBol } = await req.json();
  if (retryBol !== undefined && (typeof retryBol !== "string" || !/^[A-Z]{4}\d{7}$/.test(retryBol)))
    return NextResponse.json({ error: "Choose one container to retry its BOL." }, { status: 400 });
  if (terminal !== "SAV" || !/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "Choose a Savannah booking." }, { status: 400 });
  if (process.env.DRAY_IMPORT_WRITES_ENABLED !== "true" || process.env.MCLEOD_SYNC_ENABLED !== "true")
    return NextResponse.json({ error: "McLeod imaging uploads are disabled." }, { status: 409 });
  const db = staffDatabase();
  const { data: booking, error } = await db.from("cotton_outbound_bookings")
    .select("booking_number,customer").eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
  if (error) throw error;
  if (!booking || !isSavannahE2openBooking(terminal, booking.customer))
    return NextResponse.json({ error: "Choose a Savannah Louis Dreyfus booking." }, { status: 404 });
  const bookingNumber = booking.booking_number.trim();
  if (!/^[a-z0-9-]+$/i.test(bookingNumber))
    return NextResponse.json({ error: "Invalid SharePoint booking folder." }, { status: 400 });

  const [containers, lines] = await Promise.all([
    db.from("cotton_outbound_containers").select("container_number,booking_line_id").eq("booking_id", id)
      .is("split_transfer_id", null).order("sequence_no"),
    db.from("cotton_outbound_booking_lines").select("id,mark,shipping_order").eq("booking_id", id).eq("line_status", "active"),
  ]);
  if (containers.error || lines.error) throw containers.error ?? lines.error;
  const lineById = new Map(lines.data.map(line => [line.id, line]));
  const equipment = containers.data.filter(row => lineById.has(row.booking_line_id));
  const markCounts = new Map<string, number>();
  for (const row of equipment) {
    const mark = lineById.get(row.booking_line_id)!.mark.trim().toUpperCase();
    markCounts.set(mark, (markCounts.get(mark) ?? 0) + 1);
  }
  if (!equipment.length) return NextResponse.json({ error: "No active container rows on this booking." }, { status: 400 });
  if (retryBol && !equipment.some(row => String(row.container_number ?? "").trim().toUpperCase() === retryBol))
    return NextResponse.json({ error: "That container is not active on this booking." }, { status: 400 });
  const { read, getDrive } = await connectSharePoint();
  const drive = await getDrive();
  const imaging = imagingClient();
  const actor = staffActor(req);
  type Result = { container: string; orderId?: string; file?: string; status: string };
  const results: Result[] = [];
  for (const row of equipment) {
    const container = String(row.container_number ?? "").trim().toUpperCase();
    if (retryBol && container !== retryBol) continue;
    const line = lineById.get(row.booking_line_id)!;
    if (!/^[A-Z]{4}\d{7}$/.test(container) || !/^[A-Z0-9_-]+$/i.test(line.mark)) {
      results.push({ container: container || line.mark, status: "Needs a valid container and mark" });
      continue;
    }
    const match = await findLdcOrder(bookingNumber, container, line.mark, line.shipping_order ?? "");
    const { orderId, movementId } = match;
    if (!orderId) {
      results.push({ container, status: match.status });
      continue;
    }
    if (!movementId) {
      results.push({ container, orderId, status: "No verified current McLeod movement" });
      continue;
    }
    try {
      const [typesResult, orderResult, movementResult, historyResult] = await Promise.allSettled([
        imaging.types(orderId), imaging.images(orderId), imaging.movementImages(movementId),
        db.from("outbound_mcleod_document_uploads").select("id,booking_id,document_slot,receipt,status,pdf_hash,movement_retry_at").eq("mcleod_order", orderId),
      ]);
      const imagingFailure = (step: string, failure: unknown) => {
        const status = failure instanceof Error && /^McLeod imaging HTTP \d{3}$/.test(failure.message)
          ? ` (${failure.message})` : "";
        results.push({ container, orderId, status: `${step} unavailable${status}` });
      };
      if (orderResult.status === "rejected") {
        imagingFailure("Order image list", orderResult.reason);
        continue;
      }
      if (typesResult.status === "rejected") {
        imagingFailure("McLeod document types", typesResult.reason);
        continue;
      }
      if (historyResult.status === "rejected" || historyResult.value.error || !historyResult.value.data) {
        results.push({ container, orderId, status: "SCM upload history unavailable" });
        continue;
      }
      if (movementResult.status === "rejected") {
        imagingFailure("Movement image list", movementResult.reason);
      }
      const types = typesResult.value;
      const history = historyResult.value.data;
      const images = [...orderResult.value, ...(movementResult.status === "fulfilled" ? movementResult.value : [])];
      const sourceFiles = [
        { slot: "bol", type: "01", name: `${line.mark}.pdf`, folders: ["Sav Cotton Bols", bookingNumber] },
        { slot: "ingate", type: "05", name: `${container}_in.pdf`, folders: ["Savannah Interchanges", "Exports", bookingNumber] },
        { slot: "outgate", type: "05", name: `${container}_out.pdf`, folders: ["Savannah Interchanges", "Exports", bookingNumber] },
      ];
      const prior = new Map(history.map(item => [item.document_slot, item]));
      const unknownInterchanges = images.some(image => imageTypeMatches(image, "05") &&
        !history.some(item => ["ingate", "outgate"].includes(item.document_slot) && item.receipt === image.id));
      for (const file of sourceFiles) {
        if (retryBol && file.slot !== "bol") continue;
        const result = { container, orderId, file: file.name };
        const recorded = prior.get(file.slot);
        const retryable = Boolean(retryBol && recorded?.booking_id === id && recorded.status === "uncertain" &&
          !recorded.receipt && !recorded.movement_retry_at);
        if (recorded && !retryable) {
          const visible = recorded.receipt && receiptVisible(images, recorded.receipt, file.type);
          if (visible && recorded.status !== "verified") {
            const { error: reconcileError } = await db.from("outbound_mcleod_document_uploads")
              .update({ status: "verified" }).eq("mcleod_order", orderId).eq("document_slot", file.slot);
            if (reconcileError) throw reconcileError;
          }
          results.push({ ...result, status: visible ? "Already verified" : "Prior upload needs read-back review" });
          continue;
        }
        if (movementResult.status === "rejected" && !retryable) {
          results.push({ ...result, status: "Upload held until movement images can be checked" });
          continue;
        }
        if (retryBol && !retryable) {
          results.push({ ...result, status: "No eligible prior BOL attempt to retry" });
          continue;
        }
        if (file.type === "01" && images.some(image => imageTypeMatches(image, "01"))) {
          results.push({ ...result, status: "Existing type 01 BOL" });
          continue;
        }
        if (file.type === "05" && unknownInterchanges) {
          results.push({ ...result, status: "Existing type 05 image needs review" });
          continue;
        }
        if (file.slot === "bol" && markCounts.get(line.mark.trim().toUpperCase()) !== 1) {
          results.push({ ...result, status: "Mark is assigned to multiple containers; confirm the BOL manually" });
          continue;
        }
        const matchingTypes = types.filter(type => imagingCode(type.id) === imagingCode(file.type));
        const selectedType = matchingTypes.find(type => type.id === file.type) ??
          (matchingTypes.length === 1 ? matchingTypes[0] : undefined);
        if (!selectedType) {
          const available = types.slice(0, 20).map(type => type.id).join(", ") || "none";
          results.push({ ...result, status: `McLeod type ${file.type} ${matchingTypes.length ? "is ambiguous" : "unavailable"} (returned IDs: ${available})` });
          continue;
        }
        const path = [...file.folders, file.name].map(encodeURIComponent).join("/");
        let bytes: Buffer;
        try {
          const response = await read(`${drive}/root:/${path}:/content`);
          bytes = Buffer.from(await response.arrayBuffer());
        } catch (failure) {
          results.push({ ...result, status: failure instanceof Error && failure.message === "Graph HTTP 404" ? "Missing in SharePoint" : "SharePoint download failed" });
          continue;
        }
        if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
          results.push({ ...result, status: "Invalid or oversized SharePoint PDF" });
          continue;
        }
        const pdfHash = createHash("sha256").update(bytes).digest("hex");
        if (retryable && recorded.pdf_hash !== pdfHash) {
          results.push({ ...result, status: "SharePoint BOL changed since the first attempt" });
          continue;
        }
        const claimResult = retryable
          ? await db.from("outbound_mcleod_document_uploads").update({
            status: "sending", movement_retry_at: new Date().toISOString(),
            movement_retry_actor: actor, movement_retry_id: movementId,
          }).eq("id", recorded.id).eq("status", "uncertain").is("receipt", null).is("movement_retry_at", null).select("id").maybeSingle()
          : await db.from("outbound_mcleod_document_uploads").insert({
            booking_id: id, mcleod_order: orderId, document_slot: file.slot, document_type: file.type, filename: file.name,
            pdf_hash: pdfHash, status: "sending", actor,
          }).select("id").single();
        if (claimResult.error && claimResult.error.code !== "23505") throw claimResult.error;
        const claim = claimResult.data;
        if (!claim) {
          results.push({ ...result, status: "Already claimed or previously sent; check again for read-back" });
          continue;
        }
        let receipt: string | null = null;
        let status = "uncertain";
        try {
          receipt = await imaging.upload(orderId, selectedType.id, bytes, movementId);
          status = "staged";
          const readBack = await Promise.allSettled([imaging.images(orderId), imaging.movementImages(movementId)]);
          if (readBack.some(result => result.status === "fulfilled" && receiptVisible(result.value, receipt!, file.type))) status = "verified";
        } catch (failure) {
          // Preserve the claim because an HTTP failure can follow a staged upload.
          const diagnostic = failure instanceof Error && /^McLeod imaging HTTP \d{3}$/.test(failure.message)
            ? failure.message : "No usable imaging receipt";
          results.push({ ...result, status: `Movement ${movementId} · ${diagnostic}` });
        }
        const { error: receiptError } = await db.from("outbound_mcleod_document_uploads")
          .update({ status, receipt }).eq("id", claim.id);
        if (receiptError) {
          results.push({ ...result, status: "Receipt could not be saved; check McLeod before retrying" });
          continue;
        }
        results.push({ ...result, status: status === "verified" ? "Uploaded and verified" : status === "staged" ? "Accepted; indexing pending" : "Upload outcome uncertain; check McLeod" });
      }
    } catch {
      results.push({ container, orderId, status: "Could not complete the McLeod document check for this container" });
    }
  }
  return NextResponse.json({ results });
});
