import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { databaseStore, hash, readRun, vendor } from "@/lib/dray/server";
import { processInvoice, reconcileInvoice } from "@/lib/dray/engine";
import { buildPayload } from "@/lib/dray/mcleod";
import { readBookingCustomerRate } from "@/lib/dray/booking-customer-rate";
import { houstonBookingInvoice, type HoustonImportBooking, type HoustonImportSlot, type HoustonImportMark } from "@/lib/dray/houston-booking-import";
import type { CustomerBillRates } from "@/lib/warehouse/outbound/carrier-rates";

export const maxDuration = 120;
export const runtime = "nodejs";

export const POST = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!/^[a-f0-9-]{36}$/i.test(id) || !["preview", "create", "reconcile"].includes(body.action))
      throw Error("Choose a saved Houston booking.");
    const db = staffDatabase();
    const [saved, equipment, marks, ledger] = await Promise.all([
      db.from("cotton_outbound_bookings").select("*").eq("id", id).eq("terminal", "HOU").eq("site_code", "5300").maybeSingle(),
      db.from("cotton_outbound_containers").select("*").eq("booking_id", id).is("split_transfer_id", null).order("sequence_no"),
      db.from("cotton_outbound_booking_lines").select("*").eq("booking_id", id),
      db.from("dray_import_orders").select("*").eq("terminal", "HOU").eq("invoice->>bookingId", id),
    ]);
    if (saved.error || equipment.error || marks.error || ledger.error) throw Error("Could not load the complete Houston booking.");
    const booking = saved.data as HoustonImportBooking | null;
    if (!booking || booking.status !== "draft") throw Error("Choose an active Houston 5300 booking.");
    if (equipment.data.length > 500) throw Error("Import supports up to 500 booking rows.");
    // This temporary workflow always uses the port lane selected for this import.
    const rate = await readBookingCustomerRate(db, { ...booking, return_location_code: "HOUPORT", return_location: "HOUPORT" });
    const cents = (value: unknown) => value == null ? null : Math.round(Number(value) * 100);
    const billing: CustomerBillRates | null = rate ? {
      base: rate.fuel_mode === "all_in" ? cents(rate.base_rate) : null,
      minimumChassisDays: Number(rate.included_chassis_days), chassisDays: cents(rate.chassis_daily_rate),
      chassisSplits: cents(rate.chassis_split_rate), stopoffs: cents(rate.stopoff_rate),
    } : null;
    const previews = (equipment.data as HoustonImportSlot[]).map(slot => {
      const record = ledger.data.find(row => row.invoice?.bookingContainerId === slot.id);
      const mark = (marks.data as HoustonImportMark[]).find(line => line.id === slot.booking_line_id);
      try {
        const source = houstonBookingInvoice(booking, slot, mark, billing, body.date);
        buildPayload(source.invoice, source.profile);
        const fingerprint = hash(source);
        const conflict = record && record.source_hash !== fingerprint;
        return { id: slot.id, sequence: slot.sequence_no, mark: mark?.mark ?? "", container: slot.container_number,
          bill: source.invoice.cents / 100, pay: source.invoice.carrierCents! / 100, carrier: source.profile.payee,
          state: record?.status ?? "ready", orderId: record?.order_id ?? null,
          issue: conflict ? "Saved import differs from this booking. Review the existing import before continuing." : record?.note ?? "",
          token: hash([booking, slot, mark, source]), fingerprint, source, record, conflict };
      } catch (error) {
        return { id: slot.id, sequence: slot.sequence_no, mark: mark?.mark ?? "", container: slot.container_number,
          state: record?.status ?? "preview_blocked", orderId: record?.order_id ?? null, issue: (error as Error).message,
          token: null, fingerprint: null, source: null, record, conflict: true };
      }
    });
    if (body.action === "preview") return NextResponse.json({ rows: previews.map(({ source, record, fingerprint, conflict, ...row }) =>
      ({ ...row, ready: !conflict && ["ready", "created"].includes(row.state), canReconcile: Boolean(record && ["creating", "creation_uncertain", "rating", "rating_uncertain", "blocked"].includes(row.state)) })),
      route: "5300 (SUPPBAT1) → HOUPORT", revenue: "HLOCA", orderType: "FLAT" }, { headers: { "Cache-Control": "private, no-store" } });
    const row = previews.find(row => row.id === body.containerId);
    if (!row) throw Error("Choose a booking load.");
    const actor = staffActor(req);
    const store = databaseStore(db, actor);
    if (body.action === "reconcile") {
      if (!row.record) throw Error("No saved import to reconcile.");
      if (["creating", "rating"].includes(row.record.status) && Date.now() - Date.parse(row.record.updated_at) < 300000)
        throw Error("This order may still be processing. Wait five minutes before reconciliation.");
      await reconcileInvoice(row.record, store, vendor(true));
    } else {
      if (process.env.DRAY_IMPORT_WRITES_ENABLED !== "true" || process.env.MCLEOD_SYNC_ENABLED !== "true")
        throw Error("Houston dray writes are disabled.");
      if (!row.source || row.conflict || row.token !== body.token) throw Error("Booking details changed or need review. Preview again.");
      const [freshBooking, freshSlot, freshMark] = await Promise.all([
        db.from("cotton_outbound_bookings").select("*").eq("id", id).maybeSingle(),
        db.from("cotton_outbound_containers").select("*").eq("booking_id", id).eq("id", row.id).maybeSingle(),
        db.from("cotton_outbound_booking_lines").select("*").eq("booking_id", id)
          .eq("id", equipment.data.find(slot => slot.id === row.id)!.booking_line_id).maybeSingle(),
      ]);
      if (freshBooking.error || freshSlot.error || freshMark.error ||
          hash(freshBooking.data) !== hash(saved.data) ||
          hash(freshSlot.data) !== hash(equipment.data.find(slot => slot.id === row.id)) ||
          hash(freshMark.data) !== hash(marks.data.find(mark => mark.id === freshSlot.data?.booking_line_id)))
        throw Error("The booking changed before creation. Preview the current details again.");
      const { data: runId, error } = await db.rpc("prepare_dray_import", {
        p_digest: hash({ temporaryHoustonBooking: id, row: row.source }), p_profile: row.source.profile,
        p_rows: [{ invoice: row.source.invoice, source_hash: row.fingerprint, status: "ready", note: "Temporary Houston booking import." }],
        p_actor: actor,
      });
      if (error) throw Error("Could not save the Houston import.");
      const { items } = await readRun(db, runId);
      const item = items[0];
      if (!item || item.conflict || item.order.source_hash !== row.fingerprint) throw Error("Saved import changed. Review before creating.");
      await processInvoice(item.order, store, vendor());
    }
    const { data: updated, error: updateError } = await db.from("dray_import_orders").select("status,order_id,note")
      .eq("terminal", "HOU").eq("reference", `BOOKING:${id}:${row.id}`.toUpperCase()).single();
    if (updateError) throw Error("Import outcome could not be read. Refresh before continuing.");
    return NextResponse.json({ state: updated.status, orderId: updated.order_id, issue: updated.note });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Houston import failed." }, { status: 400 });
  }
});
