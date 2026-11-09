import { dependencyFetch } from "../../http/dependency.ts";
import { lookupMcleodGateOrder } from "./mcleod-order-id.ts";
import { selectMcleodYardStop } from "./yard-stop.ts";
import { CHECKIN_SITES } from "./sites.ts";
import { referenceMatchesInput } from "./reference-match.ts";
import { formatWarehouseTime } from "./mcleod-time.ts";

type Snapshot = { orderId: string; stopId: string; company: string; arrival: string;
  schedule: unknown[]; statuses: unknown[] };
const text = (value: unknown) => String(value ?? "").trim();
function instant(value: unknown) {
  const s = text(value).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/, "$1-$2-$3T$4:$5:$6$7");
  return /(Z|[+-]\d\d:?\d\d)$/i.test(s) ? Date.parse(s) : NaN;
}
function evidence(order: any, selected: ReturnType<typeof selectMcleodYardStop>) {
  return { schedule: [selected.stop.sched_arrive_early ?? null, selected.stop.sched_arrive_late ?? null],
    statuses: [order.status ?? null, selected.movement?.status ?? null, selected.stop.status ?? null] };
}
export function arrivalConfirmed(order: any, row: any, plan: Snapshot) {
  const selected = selectMcleodYardStop(order, row.terminal, row.site_name, row.movement_direction, plan.stopId);
  const after = evidence(order, selected);
  return text(order.id) === plan.orderId && text(selected.stop.company_id || order.company_id) === plan.company &&
    instant(selected.stop.actual_arrival) === instant(plan.arrival) &&
    JSON.stringify(after.schedule) === JSON.stringify(plan.schedule) &&
    JSON.stringify(after.statuses) === JSON.stringify(plan.statuses);
}
async function request(path: string, body?: unknown) {
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw new Error("McLeod connection unavailable");
  const response = await dependencyFetch(`${base}${path}`, {
    method: body ? "PUT" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("McLeod did not confirm arrival");
  return body ? null : response.json();
}
const defaults = { request, lookup: lookupMcleodGateOrder, enabled: () => process.env.MCLEOD_SYNC_ENABLED === "true" };

/** Only saved server-owned identities/timestamps can reach the vendor. A pending
 * ledger can retry reads; a claimed write can only be reconciled, never replayed. */
export async function syncCheckinArrival(db: any, id: string, deps = defaults) {
  let attempted = false;
  try {
    const saved = await db.from("inbound_checkin_rows").select("*").eq("id", id).single();
    if (saved.error || !saved.data) throw new Error("Saved check-in unavailable");
    const row = saved.data;
    const event = await db.from("inbound_arrival_sync").select("*").eq("checkin_id", id).maybeSingle();
    if (event.error) throw new Error("Saved arrival status unavailable");
    const ledger = event.data;
    if (!ledger) return { status: "not_queued" };
    if (ledger.status === "synced") return { status: "synced" };
    if (!row.checked_in_at || !row.matched_order_id || row.local_receiving_only || row.outside_carrier_override_at)
      return { status: "unmatched" };
    const site = CHECKIN_SITES.find(s => s.terminal === row.terminal && s.siteCode === row.site_code && s.siteName === row.site_name);
    if (!site || !["pickup", "delivery"].includes(row.movement_direction)) throw new Error("Invalid saved yard or move");
    // Reconciliation remains available even when writes have been disabled.
    if (["writing", "review"].includes(ledger.status)) {
      attempted = true;
      if (ledger.status === "writing" && Date.now() - Date.parse(ledger.attempted_at) < 60000) return { status: "writing" };
      if (!ledger.snapshot) return { status: "review" };
      const current = await deps.request(`/orders/${encodeURIComponent(ledger.snapshot.orderId)}`);
      if (arrivalConfirmed(current, row, ledger.snapshot)) {
        const result = await db.from("inbound_arrival_sync").update({ status: "synced", error: null, confirmed_at: new Date().toISOString() })
          .eq("checkin_id", id).eq("status", ledger.status);
        if (result.error) throw new Error("Arrival confirmation could not be saved");
        return { status: "synced" };
      }
      await db.from("inbound_arrival_sync").update({ status: "review", error: "Arrival was not confirmed. Office review required; no repeat update was sent." })
        .eq("checkin_id", id).eq("status", ledger.status);
      return { status: "review" };
    }
    if (!deps.enabled()) return { status: "pending" };
    if (row.physical_departed_at || !["waiting", "called", "in_door", "working"].includes(row.yard_status) || row.mcleod_processing_phase === "write_pending")
      return { status: "checkout" };
    const order = await deps.request(`/orders/${encodeURIComponent(row.matched_order_id)}`);
    if (text(order.id) !== row.matched_order_id) throw new Error("Order identity differs");
    const checked = await deps.lookup(row.matched_order_id, site.terminal, site.siteName, row.movement_direction, row.matched_stop_id, order);
    const selected = selectMcleodYardStop(order, site.terminal, site.siteName, row.movement_direction, checked.stopId);
    const reference = row.reference_number || row.mark;
    if (checked.completion || checked.actualDeparture || checked.materialType !== row.material_type ||
        !referenceMatchesInput(checked.reference, reference)) throw new Error("The saved arrival does not match an open order stop");
    const company = text(selected.stop.company_id || order.company_id);
    if (!company || (order.company_id && text(order.company_id) !== company)) throw new Error("Stop company could not be verified");
    const plan: Snapshot = { orderId: row.matched_order_id, stopId: checked.stopId, company,
      arrival: formatWarehouseTime(new Date(row.checked_in_at), site.terminal), ...evidence(order, selected) };
    if (checked.actualArrival && instant(checked.actualArrival) !== instant(plan.arrival)) {
      await db.from("inbound_arrival_sync").update({ status: "review", error: "McLeod already has a different arrival time. Office review required." })
        .eq("checkin_id", id).eq("status", "pending");
      return { status: "review" };
    }
    const claim = await db.rpc("claim_inbound_arrival", { p_id: id, p_revision: row.updated_at, p_snapshot: plan });
    if (claim.error || claim.data !== true) return { status: "pending" };
    attempted = true;
    if (!checked.actualArrival) {
      // No departure, schedule, completion, billing or movement fields are sent.
      await deps.request("/stop/update", { __type: "stop", company_id: company, id: plan.stopId, actual_arrival: plan.arrival });
    }
    const after = await deps.request(`/orders/${encodeURIComponent(plan.orderId)}`);
    if (!arrivalConfirmed(after, row, plan) || text(selectMcleodYardStop(after, site.terminal, site.siteName, row.movement_direction, plan.stopId).stop.actual_departure))
      throw new Error("Arrival read-back differs");
    const result = await db.from("inbound_arrival_sync").update({ status: "synced", error: null, confirmed_at: new Date().toISOString() })
      .eq("checkin_id", id).eq("status", "writing");
    if (result.error) throw new Error("Arrival confirmation could not be saved");
    return { status: "synced" };
  } catch {
    const status = attempted ? "review" : "pending";
    try { await db.from("inbound_arrival_sync").update({ status,
      error: attempted ? "Arrival response is uncertain. Check arrival status before retrying; no repeat update will be sent."
        : "Arrival has not been sent. Retry arrival sync when McLeod is available." })
      .eq("checkin_id", id).eq("status", attempted ? "writing" : "pending"); } catch { /* Durable claim remains fenced. */ }
    return { status };
  }
}
