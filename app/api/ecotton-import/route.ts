import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { PROFILES } from "@/lib/ecotton/model";
import { parseInvoices } from "@/lib/ecotton/parse";
import {
  findDuplicates,
  identityMatches,
  verifyRatedOrder,
} from "@/lib/ecotton/mcleod";
import { processInvoice, reconcileInvoice } from "@/lib/ecotton/engine";
import { hash, databaseStore, readRun, vendor } from "@/lib/ecotton/server";
import { buildDeliveryPlan, deliverInvoice, reconcileDelivery } from "@/lib/ecotton/delivery";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
async function GETHandler(req: NextRequest) {
  const db = staffDatabase(),
    id = req.nextUrl.searchParams.get("run");
  if (id) {
    if (!uuid(id))
      return NextResponse.json(
        { ok: false, error: "Invalid run ID" },
        { status: 400 },
      );
    return NextResponse.json({
      ok: true,
      ...(await readRun(db, id)),
      writesEnabled:
        process.env.ECOTTON_IMPORT_WRITES_ENABLED === "true" &&
        process.env.MCLEOD_SYNC_ENABLED === "true",
    });
  }
  const { data: runs, error } = await db
    .from("ecotton_import_runs")
    .select("id,profile,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Import ledger is not configured.");
  return NextResponse.json({
    ok: true,
    profiles: PROFILES,
    runs,
    writesEnabled:
      process.env.ECOTTON_IMPORT_WRITES_ENABLED === "true" &&
      process.env.MCLEOD_SYNC_ENABLED === "true",
  });
}
async function POSTHandler(req: NextRequest) {
  const body = await req.json(),
    db = staffDatabase(),
    actor = staffActor(req);
  if (body.action === "preview") {
    const profile = PROFILES.find((p) => p.id === body.profileId);
    if (!profile?.confirmed)
      throw new Error("Select a terminal with confirmed import defaults.");
    if (
      typeof body.summaryCSV !== "string" ||
      typeof body.detailCSV !== "string"
    )
      throw new Error("Upload both original CSV reports.");
    const [{ data: descriptions, error: de }, { data: tariffs, error: te }] =
      await Promise.all([
        db
          .from("billing_charge_description_xref")
          .select("normalized_description,tariff_id,active")
          .eq("terminal", profile.terminal)
          .eq("active", true),
        db
          .from("tariff_charge_xref")
          .select("tariff_id,mcleod_code,active")
          .eq("terminal", profile.terminal)
          .eq("active", true),
      ]);
    if (de || te) throw new Error("Terminal billing mappings are unavailable.");
    const invoices = parseInvoices(
      body.summaryCSV,
      body.detailCSV,
      profile,
      descriptions,
      tariffs,
    );
    const v = vendor(true);
    const prepared: any[] = new Array(invoices.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < invoices.length) {
          const i = cursor++,
            invoice = invoices[i];
          let status = "ready",
            note = "Complete duplicate search found no order.",
            order_id = null;
          try {
            const candidates = await findDuplicates(v.read, invoice, profile);
            if (candidates.length) {
              if (
                candidates.length === 1 &&
                identityMatches(candidates[0], invoice, profile)
              ) {
                order_id = candidates[0].id;
                const errors = verifyRatedOrder(
                  candidates[0],
                  invoice,
                  profile,
                );
                status = errors.length ? "preview_blocked" : "verified";
                note = errors.length
                  ? "Existing order needs review: " + errors.join("; ")
                  : "Existing order already matches; no creation or rating needed.";
              } else {
                status = "preview_blocked";
                note =
                  "Existing order reference is ambiguous or conflicts with source: " +
                  candidates.map((o) => o.id).join(", ");
              }
            }
          } catch (e) {
            status = "preview_blocked";
            note = (e as Error).message;
          }
          prepared[i] = {
            invoice,
            status,
            note,
            order_id,
            source_hash: hash({ invoice, profile }),
          };
        }
      }),
    );
    const digest = hash({ profile, invoices });
    const { data: id, error } = await db.rpc("prepare_ecotton_import", {
      p_digest: digest,
      p_profile: profile,
      p_rows: prepared,
      p_actor: actor,
    });
    if (error) throw new Error("Could not save import preview.");
    return NextResponse.json({
      ok: true,
      ...(await readRun(db, id)),
      writesEnabled:
        process.env.ECOTTON_IMPORT_WRITES_ENABLED === "true" &&
        process.env.MCLEOD_SYNC_ENABLED === "true",
    });
  }
  if (!uuid(body.runId) || !uuid(body.rowId))
    throw new Error("Select a saved import run and row.");
  const { items } = await readRun(db, body.runId),
    item = items.find((x) => x.order_id === body.rowId);
  if (!item || item.conflict || item.source_hash !== item.order.source_hash)
    throw new Error(
      "This upload conflicts with an earlier import. Review its saved run.",
    );
  const row = item.order,
    store = databaseStore(db, actor);
  if (body.action === "delivery-preview") {
    if (row.status !== "verified") throw new Error("Only verified orders can be delivered.");
    const plan = buildDeliveryPlan(await vendor(true).read("/orders/" + encodeURIComponent(row.order_id)), row);
    return NextResponse.json({ ok: true, plan, planHash: hash(plan) });
  } else if (body.action === "deliver") {
    if (body.confirmed !== true) throw new Error("Review and confirm delivery details first.");
    if (process.env.ECOTTON_IMPORT_WRITES_ENABLED !== "true" || process.env.MCLEOD_SYNC_ENABLED !== "true")
      throw new Error("Delivery writes are disabled in this environment.");
    if (row.status !== "verified") throw new Error("Only verified orders can be delivered.");
    const v = vendor();
    const plan = buildDeliveryPlan(await v.read("/orders/" + encodeURIComponent(row.order_id)), row);
    if (typeof body.planHash !== "string" || hash(plan) !== body.planHash) throw new Error("Delivery details changed. Review a fresh preview.");
    await deliverInvoice(row, store, v, plan);
  } else if (body.action === "reconcile-delivery") {
    if (row.status === "delivering" && Date.now() - new Date(row.updated_at).getTime() < 300000)
      throw new Error("Delivery may still be running. Wait five minutes before reconciling.");
    await reconcileDelivery(row, store, vendor(true));
  } else if (body.action === "execute") {
    if (body.confirmed !== true)
      throw new Error(
        "Review and confirm this import before creating or rating orders.",
      );
    // Check BEFORE claiming; disabled writes cannot leave a row in an uncertain state.
    if (
      process.env.ECOTTON_IMPORT_WRITES_ENABLED !== "true" ||
      process.env.MCLEOD_SYNC_ENABLED !== "true"
    )
      throw new Error(
        "Creation/rating disabled. Preview and read-only reconciliation remain available.",
      );
    await processInvoice(row, store, vendor());
  } else if (body.action === "recheck") {
    if (row.status !== "preview_blocked")
      throw new Error("Only a preview-blocked row can be rechecked.");
    const candidates = await findDuplicates(
      vendor(true).read,
      row.invoice,
      row.profile,
    );
    if (candidates.length === 0)
      await store.finish(
        row,
        "ready",
        null,
        "Fresh complete duplicate search found no order; no writes.",
      );
    else if (
      candidates.length === 1 &&
      identityMatches(candidates[0], row.invoice, row.profile) &&
      !verifyRatedOrder(candidates[0], row.invoice, row.profile).length
    )
      await store.finish(
        row,
        "verified",
        candidates[0].id,
        "Existing order read-back verified; no writes.",
      );
    else
      await store.finish(
        row,
        "preview_blocked",
        null,
        "Existing order still conflicts with source. Review required.",
      );
  } else if (body.action === "reconcile") {
    if (
      ["creating", "rating"].includes(row.status) &&
      Date.now() - new Date(row.updated_at).getTime() < 300000
    )
      throw new Error(
        "This request may still be running. Wait five minutes before reconciling.",
      );
    await reconcileInvoice(row, store, vendor(true));
  } else throw new Error("Unknown import action.");
  return NextResponse.json({ ok: true, ...(await readRun(db, body.runId)) });
}
function readableErrors(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    try {
      return await handler(req);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Import request failed.";
      return NextResponse.json(
        { ok: false, error: message.slice(0, 600) },
        { status: 400 },
      );
    }
  };
}
export const GET = withStaffAccess(readableErrors(GETHandler));
export const POST = withStaffAccess(readableErrors(POSTHandler));
