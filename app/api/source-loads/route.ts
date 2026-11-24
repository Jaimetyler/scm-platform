import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";
import { staffActor, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { previewToyoSourceLoads } from "@/lib/warehouse/outbound/source-loads";

import { sourceLoadPayload, verifySourceLoad } from "@/lib/warehouse/outbound/source-load-create";
import { nonVoidBlnumMatches } from "@/lib/bunge/duplicates";
import { readActiveDeliveryLocation } from "@/lib/bunge/delivery-server";
import { vendor } from "@/lib/dray/server";
import { scheduleForPickup } from "@/lib/cotton-import/scheduling";

export const maxDuration = 120;
export const runtime = "nodejs";

export const POST = withStaffAccess(async (req: NextRequest) => {
  try {
    if (Number(req.headers.get("content-length")) > 3 * 1024 * 1024 + 65536)
      throw Error("Maximum workbook size is 3 MB.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 3 * 1024 * 1024 || !/\.xlsx$/i.test(file.name))
      throw Error("Choose an XLSX workbook up to 3 MB.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, sheets: 0 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw Error("No dispatch sheet found.");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: "" });
    const db = staffDatabase();
    const { data, error } = await db.from("cotton_location_master")
      .select("id,mcleod_code,prev_code,name,timezone,active,city,state").limit(3000);
    if (error) return NextResponse.json({ error: "Could not load the cotton location master." }, { status: 503 });
    const preview = previewToyoSourceLoads(rows, data ?? []);
    const action = form.get("action");
    if (action === null)
      return NextResponse.json(preview, { headers: { "Cache-Control": "private, no-store" } });
    if (action !== "create") throw Error("Unknown Source Load action.");
    if (process.env.BUNGE_IMPORT_WRITES_ENABLED !== "true") throw Error("Live cotton order creation is disabled.");
    const base = process.env.MCLEOD_BASE_URL;
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw Error("McLeod create connection is unavailable.");

    const line = preview.lines.find(item => item.sourceRow === Number(form.get("sourceRow")));
    if (!line?.mcleodDraft || !line.readyDate || !line.blnum || !preview.returnCode)
      throw Error("Select a mapped load from the dispatch.");
    if (line.readyDate < new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date()))
      throw Error("Historical pickup dates are for preview only.");
    const location = data?.find(item => item.mcleod_code === line.pickupCode);
    if (!location) throw Error("Pickup location unavailable.");
    const { data: schedules, error: scheduleError } = await db.from("cotton_location_schedules")
      .select("location_id,weekday,open_time,close_time,checkin_cutoff,appointment_required,verified,effective_from,effective_to")
      .eq("location_id", location.id).limit(5000);
    if (scheduleError || !schedules) throw Error("Pickup schedules unavailable.");
    const pickup = scheduleForPickup(schedules, location.id, line.readyDate, location.mcleod_code);
    if (pickup.status !== "ready" || !pickup.early || !pickup.late) throw Error(pickup.reason);
    const payload = sourceLoadPayload(preview, line, { early: pickup.early, late: pickup.late }, String(form.get("cutoffTime") ?? ""));
    const ledger = db.from("cotton_bunge_import_orders");
    const existing = await ledger.select("status,mcleod_order_id").eq("customer_id", preview.customerId)
      .eq("revenue_code", preview.revenueCode).eq("blnum", line.blnum).maybeSingle();
    if (existing.error) throw Error("Source Load audit unavailable.");
    if (existing.data) throw Error(existing.data.mcleod_order_id
      ? `This load already has McLeod order ${existing.data.mcleod_order_id}.`
      : "A prior create attempt is locked. Check the audit and McLeod before retrying.");
    const mcleod = vendor(true);
    const [duplicates] = await Promise.all([
      nonVoidBlnumMatches(mcleod.read, line.blnum, [line.readyDate], preview.customerId),
      readActiveDeliveryLocation(preview.returnCode),
    ]);
    if (duplicates.length) throw Error(`Existing McLeod order found: ${duplicates.map(order => order.id).join(", ")}.`);
    const claim = await ledger.insert({
      source_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      sales_order: line.ordered_by || "", customer_id: preview.customerId, revenue_code: preview.revenueCode,
      blnum: line.blnum, destination_code: preview.returnCode, source_filename: file.name,
      original_pickups: [{ locationCode: line.pickupCode, readyDate: line.readyDate, row: line.sourceRow }],
      reviewed_payload: { payload, actor: staffActor(req) }, status: "creating",
    }).select("id").single();
    if (claim.error || !claim.data) throw Error("Could not claim this load. Check the audit before retrying.");

    let orderId: string | null = null;
    let problem: string | null = null;
    try {
      const response = await fetch(base.replace(/\/$/, "") + "/orders/create", {
        method: "PUT", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw Error(`McLeod create returned HTTP ${response.status}.`);
      const created = await response.json();
      const id = String(created?.id ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw Error("McLeod returned no valid order ID.");
      orderId = id;
      const actual = await mcleod.read("/orders/" + encodeURIComponent(id));
      if (String(actual?.id ?? "").trim() !== id) throw Error("McLeod order identity could not be verified.");
      verifySourceLoad(actual, payload);
    } catch (reason) {
      problem = reason instanceof Error ? reason.message : "McLeod creation could not be verified.";
    }
    const saved = await ledger.update({
      status: problem ? orderId ? "created" : "creation_uncertain" : "verified",
      mcleod_order_id: orderId, error_message: problem, updated_at: new Date().toISOString(),
    }).eq("id", claim.data.id).eq("status", "creating").select("id").maybeSingle();
    if (saved.error || !saved.data || problem)
      return NextResponse.json({ orderId, error: `${problem ?? "Audit update failed."} Check McLeod and the audit before retrying.` }, { status: 502 });
    return NextResponse.json({ orderId, verified: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview the dispatch." }, { status: 400 });
  }
});
