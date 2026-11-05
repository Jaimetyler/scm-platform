import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { terminalDeliveryCode } from "@/lib/bunge/destinations";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { readDeliveryLocation } from "@/lib/bunge/delivery-server";
import { nonVoidBlnumMatches } from "@/lib/bunge/duplicates";
import { vendor } from "@/lib/dray/server";
import { parseBungeDispatch } from "@/lib/cotton-import/bunge-dispatch";
import { previewBungeDispatchOrders } from "@/lib/cotton-import/bunge-review";
import { draftHoustonOrder } from "@/lib/cotton-import/pilot";
import { requestedEquipment, reviewPickupEquipment } from "@/lib/cotton-import/equipment";
import { scheduleForPickup, type CottonSchedule } from "@/lib/cotton-import/scheduling";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function preflight(req: NextRequest) {
  const form = await req.formData();
  const destination = terminalDeliveryCode("houston", form.get("destination"));
  if (destination !== "SUPPBAT1" && destination !== "SUPPPAT1") throw new Error("Choose a Houston delivery location.");
  const file = form.get("file");
  const requested = requestedEquipment(form.get("equipment"));
  const salesOrder = String(form.get("salesOrder") ?? "").trim();
  if (!(file instanceof File) || !/\.xlsx?$/i.test(file.name) || file.size === 0 ||
      file.size > 2_000_000 || !/^\d{5,}$/.test(salesOrder))
    throw new Error("Select one sales order and upload its original Excel dispatch (under 2 MB).");

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Workbook has no first worksheet.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  const dispatch = parseBungeDispatch(rows);
  if (dispatch.destinationKind !== "HOUSTON") throw new Error("Upload a Houston Bunge dispatch.");
  const matches = dispatch.orders.filter(order => order.salesOrder === salesOrder);
  if (matches.length !== 1) throw new Error("Selected sales order must appear exactly once in the dispatch.");
  const source = matches[0];

  const db = staffDatabase();
  const locations = await db.from("cotton_location_master")
    .select("id,mcleod_code,prev_code,name,timezone,active").limit(5000);
  if (locations.error || !locations.data) throw new Error("Location master unavailable.");
  const review = previewBungeDispatchOrders(matches, dispatch.destinationKind, locations.data, destination)[0];
  const proposal = review.preview;
  if (!proposal) throw new Error("Selected order blocked: " + review.reason);

  const pickupIds = proposal.pickupStops.map(stop => stop.locationId);
  const [schedules, equipmentRows] = await Promise.all([db.from("cotton_location_schedules")
    .select("location_id,weekday,open_time,close_time,checkin_cutoff,appointment_required,verified,effective_from,effective_to")
    .in("location_id", pickupIds).limit(5000),
    db.from("cotton_location_equipment").select("location_id,accepted_equipment,effective_date,verified")
      .in("location_id", pickupIds).limit(5000),
  ]);
  if (equipmentRows.error || !equipmentRows.data) throw new Error("Location equipment rules unavailable.");
  const equipment = reviewPickupEquipment(proposal.pickupStops, equipmentRows.data, requested);
  if (schedules.error || !schedules.data) throw new Error("Pickup schedule unavailable.");
  const windows = proposal.pickupStops.map(stop => ({
    locationCode: stop.locationCode, originalRtlDate: stop.scheduledDate,
    ...scheduleForPickup(schedules.data as CottonSchedule[], stop.locationId, stop.scheduledDate, stop.locationCode),
  }));
  const response = { ok: true, canCreate: false, salesOrder, blnum: proposal.blnum, windows, equipment };
  if (equipment.reason) return NextResponse.json({ ...response, reason: equipment.reason });
  if (windows.some(window => window.status !== "ready"))
    return NextResponse.json({ ...response, reason: "Pickup schedule requires review." });

  const ledger = db.from("cotton_bunge_import_orders");
  const auditFields = "id,source_hash,status,mcleod_order_id,destination_code";
  const findAudit = () => ledger.select(auditFields).eq("customer_id", proposal.customerId)
    .eq("revenue_code", proposal.revenueCode).eq("blnum", proposal.blnum).maybeSingle();
  const existing = await findAudit();
  if (existing.error) throw new Error("Import audit ledger is unavailable in this environment.");

  const originalPickups = source.pickups.map(line => ({
    row: line.row, mark: line.mark, salesOrder: line.salesOrder, bales: line.bales,
    warehouse: line.warehouse, usdaWarehouseCode: line.usdaWarehouseCode, originalRtl: line.rtl,
  }));
  const hashSource = (destinationCode: string, legacy = false) => createHash("sha256").update(JSON.stringify({
    salesOrder, blnum: proposal.blnum, destination: destinationCode,
    originalPickups: legacy ? originalPickups.map(line => ({ ...line, usdaWarehouseCode: null })) : originalPickups,
  })).digest("hex");
  const sourceHash = hashSource(proposal.deliveryLocation);
  // Compare older records against their original selection and the original pickup lines.
  const sameSource = (row: { source_hash: string; destination_code: string }) =>
    row.source_hash === hashSource(row.destination_code) || row.source_hash === hashSource(row.destination_code, true);
  if (existing.data && !sameSource(existing.data))
    throw new Error("Existing audit record conflicts with this dispatch.");

  const [duplicates, delivery] = await Promise.all([
    nonVoidBlnumMatches(vendor(true).read, proposal.blnum, windows.map(window => window.originalRtlDate)),
    readDeliveryLocation(proposal.deliveryLocation),
  ]);
  if (duplicates.length)
    return NextResponse.json({ ...response, delivery, duplicates, reason: "Existing McLeod order found. Creation is blocked." });

  if (!existing.data) {
    const inserted = await ledger.upsert({
      source_hash: sourceHash, sales_order: salesOrder, blnum: proposal.blnum,
      customer_id: proposal.customerId, revenue_code: proposal.revenueCode,
      destination_code: proposal.deliveryLocation, source_filename: file.name,
      original_pickups: originalPickups, status: "previewed",
    }, { onConflict: "customer_id,revenue_code,blnum", ignoreDuplicates: true });
    if (inserted.error) throw new Error("Could not save original RTL audit record.");
  }
  const saved = await findAudit();
  if (saved.error || !saved.data || !sameSource(saved.data))
    throw new Error("Audit record read-back could not verify the selected dispatch.");
  if (saved.data.status !== "previewed" || saved.data.mcleod_order_id)
    return NextResponse.json({ ...response, delivery, auditId: saved.data.id, auditStatus: saved.data.status,
      reason: "This order already has a pilot audit state. Review the existing record before proceeding." });

  return NextResponse.json({
    ...response, delivery, duplicates, auditId: saved.data.id, auditStatus: saved.data.status,
    dispatchDestination: { name: dispatch.destination, address: rows.slice(rows.findIndex(row => String(row[0]).trim().toUpperCase() === "DESTINATION:") + 1).slice(0, 2).map(row => String(row[1] ?? "")) },
    draft: draftHoustonOrder(source, proposal, windows, equipment.code),
    reason: saved.data.destination_code === proposal.deliveryLocation
      ? "Audit record verified and no matching BLNUM found. Confirm the delivery address, McLeod create fields and read-back before the pilot."
      : `No matching BLNUM found. The existing audit record uses ${saved.data.destination_code}. The new delivery selection is shown in the draft and needs audit reconciliation before the pilot.`,
  });
}

export const POST = withStaffAccess(async (req: NextRequest) => {
  try {
    return await preflight(req);
  } catch (error) {
    return NextResponse.json({ ok: false, canCreate: false,
      error: error instanceof Error ? error.message : "Preflight failed." }, { status: 400 });
  }
});
