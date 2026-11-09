import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { inboundTerminal, cottonTerminalDeliveryCode, OLAM_CUSTOMER, SCM_DELIVERY_LOCATIONS, cottonReceivingHours } from "@/lib/bunge/destinations";
import { staffActor, staffProfile, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { readActiveDeliveryLocation, readDeliveryLocation } from "@/lib/bunge/delivery-server";
import { nonVoidBlnumMatches } from "@/lib/bunge/duplicates";
import { vendor } from "@/lib/dray/server";
import { parseOlamWorkbook } from "@/lib/bunge/olam";
import { parseDispatch } from "@/lib/bunge/preview";
import { regionalOrder } from "@/lib/cotton-import/regional-dispatch";
import { parseBungeDispatch } from "@/lib/cotton-import/bunge-dispatch";
import { previewBungeDispatchOrders } from "@/lib/cotton-import/bunge-review";
import { readPickupPolicies } from "@/lib/cotton-import/pickup-policy-server";
import { draftPickupNotes } from "@/lib/cotton-import/pickup-notes";
import { houstonPilotPayload, isArrivalFormatRejection, isMissingCollectionMethodRejection, matchCorrectedSchedule, verifyHoustonPilot } from "@/lib/cotton-import/pilot-create";
import { draftHoustonOrder } from "@/lib/cotton-import/pilot";
import { requestedEquipment, reviewPickupEquipment } from "@/lib/cotton-import/equipment";
import { scheduleForPickup, type CottonSchedule } from "@/lib/cotton-import/scheduling";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function preflight(req: NextRequest) {
  const form = await req.formData();
  const olamRequested = form.get("action") === "preflight-olam";
  const create = form.get("action") === "create-pilot";
  const reconcile = form.get("action") === "reconcile-pilot";
  const canRecover = staffProfile(req)?.role === "admin";
  if (reconcile && !canRecover) return NextResponse.json({ ok: false, error: "Administrator access is required to reopen an order." }, { status: 403 });
  const pilotEnabled = process.env.BUNGE_IMPORT_WRITES_ENABLED === "true" ||
    process.env.BUNGE_UNITED_AG_PILOT_ENABLED === "true";
  if ((create || reconcile) && !pilotEnabled) throw Error("Live cotton order creation is disabled.");
  const terminal = inboundTerminal(form.get("terminal") ?? "houston");
  if (!terminal) throw Error("Unknown inbound location.");
  const houston = terminal.id === "houston";
  const file = form.get("file");
  const requested = requestedEquipment(form.get("equipment"));
  const salesOrder = String(form.get("salesOrder") ?? "").trim();
  if (!(file instanceof File) || !/\.(xlsb|xlsx|xls|csv)$/i.test(file.name) || !file.size ||
      file.size > 3 * 1024 * 1024 || !/^\d{5,}$/.test(salesOrder))
    throw Error("Select one sales order and upload its original dispatch workbook (up to 3 MB).");
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const parsedOlam = parseOlamWorkbook(workbook);
  const olam = parsedOlam !== null;
  if (olamRequested && !olam) throw Error("Upload the original OLAM dispatch workbook.");
  if (form.get("customerId") && form.get("customerId") !== (olam ? OLAM_CUSTOMER : "BUNGOMNE"))
    throw Error("The uploaded workbook customer does not match the reviewed customer.");
  if (!olam && /\.xlsb$/i.test(file.name)) throw Error("XLSB uploads must be original OLAM load lists.");
  if (!olam && houston && file.size > 2_000_000) throw Error("Houston Bunge workbook exceeds 2 MB.");
  if (!olam && terminal.id === "dallas" && !form.get("destination")) throw Error("Select the Dallas delivery location.");
  const destination = cottonTerminalDeliveryCode(terminal.id, form.get("destination") || parsedOlam?.destination);

  const db = staffDatabase();
  const locations = await db.from("cotton_location_master")
    .select("id,mcleod_code,prev_code,name,timezone,active").limit(5000);
  if (locations.error || !locations.data) throw new Error("Location master unavailable.");
  let workbookDestination: { name: string; address: string[] } | undefined;
  const { source, proposal } = (() => {
    if (olam) {
      const parsed = parsedOlam;
      if (!parsed) throw Error("Upload the original OLAM dispatch workbook.");
      return regionalOrder(parsed.lines, salesOrder, destination, terminal.revenue, locations.data, OLAM_CUSTOMER);
    }
    if (!houston) {
      const parsed = parseDispatch(new Uint8Array(bytes));
      const regionPattern = terminal.id === "savannah" ? /SAVANNAH|\(SAV\)/i : /DALLAS|DESOTO/i;
      if (!parsed.destinations.length || parsed.destinations.some(value => !regionPattern.test(value)))
        throw Error("The workbook destination does not match the selected inbound region.");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      if (parsed.lines.some(line => line.so === salesOrder && line.rtl && line.rtl < today))
        throw Error("Historical pickup dates are for preview only.");
      return regionalOrder(parsed.lines, salesOrder, destination, terminal.revenue, locations.data);
    }
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw Error("Workbook has no first worksheet.");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const dispatch = parseBungeDispatch(rows);
    if (dispatch.destinationKind !== "HOUSTON") throw Error("Upload a Houston Bunge dispatch.");
    const matches = dispatch.orders.filter(order => order.salesOrder === salesOrder);
    if (matches.length !== 1) throw Error("Selected sales order must appear exactly once in the dispatch.");
    const review = previewBungeDispatchOrders(matches, dispatch.destinationKind, locations.data, destination)[0];
    if (!review.preview) throw Error("Selected order blocked: " + review.reason);
    workbookDestination = { name: dispatch.destination,
      address: rows.slice(rows.findIndex(row => String(row[0]).trim().toUpperCase() === "DESTINATION:") + 1, rows.length)
        .slice(0, 2).map(row => String(row[1] ?? "")) };
    return { source: matches[0], proposal: review.preview };
  })();

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
  const response = { ok: true, canCreate: false, pilotBuild: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7), salesOrder, blnum: proposal.blnum, windows, equipment };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: terminal.id === "savannah" ? "America/New_York" : "America/Chicago" }).format(new Date());
  if (windows.some(window => window.originalRtlDate < today))
    return NextResponse.json({ ...response, reason: "Historical pickup dates are for preview only." });
  if (!equipment.code) return NextResponse.json({ ...response, reason: equipment.reason || "Equipment requires review." });
  if (windows.some(window => window.status !== "ready"))
    return NextResponse.json({ ...response, reason: "Pickup schedule requires review." });

  const ledger = db.from("cotton_bunge_import_orders");
  const auditFields = "id,source_hash,status,mcleod_order_id,destination_code,error_message,reviewed_payload,updated_at";
  const findAudit = () => ledger.select(auditFields).eq("customer_id", proposal.customerId)
    .eq("revenue_code", proposal.revenueCode).eq("blnum", proposal.blnum).maybeSingle();
  const existing = await findAudit();
  if (existing.error) throw new Error("Import audit ledger is unavailable in this environment.");

  const originalPickups = source.pickups.map(line => ({
    row: line.row, mark: line.mark, salesOrder: line.salesOrder, bales: line.bales,
    warehouse: line.warehouse, usdaWarehouseCode: line.usdaWarehouseCode, originalRtl: line.rtl,
    ...(!houston || olam ? { weight: line.weight ?? null } : {}),
  }));
  const hashSource = (destinationCode: string, legacy = false) => createHash("sha256").update(JSON.stringify({
    salesOrder, blnum: proposal.blnum, destination: destinationCode,
    ...(olam ? { customerId: OLAM_CUSTOMER, bookingNumber: source.bookingNumber ?? null } : {}),
    originalPickups: legacy ? originalPickups.map(line => ({ ...line, usdaWarehouseCode: null })) : originalPickups,
  })).digest("hex");
  const sourceHash = hashSource(proposal.deliveryLocation);
  // Compare older records against their original selection and the original pickup lines.
  const sameSource = (row: { source_hash: string; destination_code: string }) =>
    row.source_hash === hashSource(row.destination_code) || row.source_hash === hashSource(row.destination_code, true);
  if (existing.data && !sameSource(existing.data))
    throw new Error("Existing audit record conflicts with this dispatch.");

  const [duplicates, delivery, policies] = await Promise.all([
    nonVoidBlnumMatches(vendor(true).read, proposal.blnum, windows.map(window => window.originalRtlDate), proposal.customerId),
    SCM_DELIVERY_LOCATIONS.some(location => location.code === proposal.deliveryLocation)
      ? readDeliveryLocation(proposal.deliveryLocation)
      : readActiveDeliveryLocation(proposal.deliveryLocation).then(location => ({ ...location, receivingHours: cottonReceivingHours(proposal.deliveryLocation) })),
    readPickupPolicies(db, pickupIds),
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
  const canReconcile = !olam && canRecover && pilotEnabled && salesOrder === "2601730" && proposal.blnum === "C0437 90 BALES" &&
    saved.data.destination_code === "SUPPBAT1" && proposal.deliveryLocation === "SUPPBAT1" &&
    saved.data.status === "creation_uncertain" && saved.data.mcleod_order_id === null &&
    saved.data.error_message === "McLeod create returned HTTP 406." &&
    Boolean(saved.data.reviewed_payload?.payload && !saved.data.reviewed_payload.previousAttempt);
  if (reconcile) {
    if (!canReconcile || form.get("confirmation") !== salesOrder)
      throw Error("This rejected order is not eligible for manual reconciliation.");
    const reopened = await ledger.update({ status: "previewed", error_message: null,
      reviewed_payload: { previousAttempt: { request: saved.data.reviewed_payload, error: saved.data.error_message,
        at: saved.data.updated_at, reconciliation: "Operator confirmed no match in McLeod Ordered by search",
        reconciledBy: staffActor(req), reconciledAt: new Date().toISOString() } },
      updated_at: new Date().toISOString(),
    }).eq("id", saved.data.id).eq("status", "creation_uncertain").eq("updated_at", saved.data.updated_at)
      .is("mcleod_order_id", null).select("id").maybeSingle();
    if (reopened.error || !reopened.data) throw Error("Audit state changed. Run preflight again.");
    return NextResponse.json({ ...response, auditStatus: "previewed", reconciled: true,
      reason: "The original rejection is preserved and the order was reopened." });
  }
  const arrivalRetry = !olam && isArrivalFormatRejection(salesOrder, saved.data);
  const correctedRetry = arrivalRetry || !olam && isMissingCollectionMethodRejection(salesOrder, saved.data);
  if (!correctedRetry && (saved.data.status !== "previewed" || saved.data.mcleod_order_id)) {
    let comparison: Record<string, unknown> | undefined;
    if (salesOrder === "2601730" && saved.data.status === "creation_uncertain") {
      // Read the order from Jaime's example to compare only the relevant defaults.
      try {
        const example = await vendor(true).read("/orders/0828093");
        if (example?.id !== "0828093" || example.customer_id !== "BUNGOMNE" ||
            example.revenue_code_id !== "MAIN" || example.commodity_id !== "COTTON")
          throw Error("Reference order identity could not be verified.");
        comparison = Object.fromEntries([
          "id", "order_type_id", "order_mode", "equipment_type_id", "collection_method", "rate_type", "rate_units",
        ].map(field => [field, example[field] ?? null]));
        comparison.movementCount = Array.isArray(example.movements) ? example.movements.length : null;
      } catch {
        comparison = { error: "The historical Baytown example could not be read or verified." };
      }
    }
    return NextResponse.json({ ...response, delivery, duplicates, comparison, canReconcile,
      auditId: saved.data.id, auditStatus: saved.data.status,
      reason: saved.data.status === "creation_uncertain"
        ? (canReconcile ? "No matching BLNUM found. Search McLeod by Ordered by 2601730 before reopening this order." : "No matching BLNUM found in the configured pickup-date range. The earlier create attempt is still locked; review the audit and McLeod before any retry.")
        : "This order already has a pilot audit state. Review the existing record before proceeding." });
  }

  const draft = { ...draftHoustonOrder(source, proposal, windows, equipment.code),
    pickupNotes: draftPickupNotes(proposal.pickupStops, policies) };
  let payload = houstonPilotPayload(draft, terminal.id);
  if (payload) {
    try {
      const example = await vendor(true).read("/orders/0829475");
      payload = matchCorrectedSchedule(payload, example);
    } catch (cause) {
      return NextResponse.json({ ...response, delivery, draft, auditStatus: saved.data.status,
        reason: cause instanceof Error ? cause.message : "The corrected McLeod schedule could not be verified." });
    }
  }
  const createBlock = !pilotEnabled ? "Live cotton order creation is disabled on this deployment."
    : !payload ? "Live creation requires complete weight and a verified pickup schedule. Choose a delivery location in the selected terminal."
    : saved.data.destination_code !== proposal.deliveryLocation ? "The audit destination differs from the selected delivery site."
    : null;
  const canCreate = createBlock === null;
  const reviewToken = canCreate ? createHash("sha256").update(JSON.stringify({ payload, auditId: saved.data.id, auditVersion: saved.data.updated_at })).digest("hex") : null;
  if (create) {
    if (!canCreate || !payload || form.get("reviewToken") !== reviewToken)
      throw Error("Run a fresh preflight and review the order before creating.");
    const base = process.env.MCLEOD_BASE_URL;
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw Error("McLeod create connection is unavailable.");
    const claim = await ledger.update({ status: "creating", reviewed_payload: { payload, actor: staffActor(req), ...(saved.data.reviewed_payload?.previousAttempt ? { previousAttempt: saved.data.reviewed_payload.previousAttempt }
      : correctedRetry ? { previousAttempt: { request: saved.data.reviewed_payload, error: saved.data.error_message, at: saved.data.updated_at } } : {}) },
      updated_at: new Date().toISOString() }).eq("id", saved.data.id).eq("status", saved.data.status).eq("updated_at", saved.data.updated_at)
      .eq("source_hash", saved.data.source_hash).is("mcleod_order_id", null).select("id").maybeSingle();
    if (claim.error || !claim.data) throw Error("Pilot claim failed. Check the audit record before retrying.");

    let orderId: string | null = null;
    let status = "creation_uncertain";
    let error: string | null = null;
    try {
      const result = await fetch(base.replace(/\/$/, "") + "/orders/create", {
        method: "PUT", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!result.ok) {
        const body = await result.text();
        const detail = body.trim().replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 300);
        throw Error(`McLeod create returned HTTP ${result.status}.${detail ? " " + detail : ""}`);
      }
      const created = await result.json();
      const id = String(created?.id ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw Error("McLeod returned no valid order ID.");
      orderId = id;
      status = "created";
      const actual = await vendor(true).read("/orders/" + encodeURIComponent(id));
      const mismatches = verifyHoustonPilot(actual, id, payload);
      if (mismatches.length) throw Error("Read-back differs: " + mismatches.join(", "));
      status = "verified";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "McLeod request failed.";
    }
    const finish = await ledger.update({ status, mcleod_order_id: orderId, error_message: error,
      updated_at: new Date().toISOString() }).eq("id", saved.data.id).eq("status", "creating").select("id").maybeSingle();
    const persisted = !finish.error && Boolean(finish.data);
    return NextResponse.json({ ...response, delivery, draft, mcleodOrderId: orderId,
      ok: status === "verified" && persisted, auditStatus: persisted ? status : "creating",
      reason: !persisted ? "Audit update failed. Do not retry. Check McLeod and the audit record."
        : error ? `${error} Do not retry. Check McLeod and the audit record.`
        : `McLeod order ${orderId} created and verified on read-back.` });
  }

  return NextResponse.json({
    ...response, delivery, duplicates, auditId: saved.data.id, auditStatus: saved.data.status,
    dispatchDestination: workbookDestination,
    draft, canCreate, reviewToken,
    reason: createBlock ?? (correctedRetry
      ? "The corrected one-order retry is ready. Its schedule matches McLeod order 0829475."
      : "Ready to create in McLeod."),

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
