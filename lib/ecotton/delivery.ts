import { verifyRatedOrder } from "./mcleod.ts";
import { normalize } from "./model.ts";
import type { Ledger, Store, Vendor } from "./engine.ts";

export type DeliveryPlan = {
  orderId: string;
  movementId: string;
  company: string;
  stops: { id: string; type: string; arrival: string; departure: string }[];
};
function timestamp(value: unknown): number {
  const m = String(value ?? "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/);
  if (!m) throw new Error("Scheduled dates must be complete McLeod timestamps.");
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}:${m[8]}`;
  const n = Date.parse(iso);
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!Number.isFinite(n) || day.getUTCMonth() !== +m[2] - 1 || day.getUTCDate() !== +m[3])
    throw new Error("Invalid scheduled date.");
  return n;
}
export function buildDeliveryPlan(order: any, row: Ledger): DeliveryPlan {
  if (row.profile.id !== "HOU-HOUWHSE") throw new Error("Delivery is currently enabled for Houston eCotton only.");
  const errors = verifyRatedOrder(order, row.invoice, row.profile);
  if (!row.order_id || String(order.id) !== row.order_id) errors.push("Saved order ID differs");
  if (!['A', 'D'].includes(normalize(order.status)) || order.xferred2billing === true)
    errors.push("Order is closed, billed, or has an unsupported status");
  if (errors.length) throw new Error("Delivery blocked: " + errors.join("; "));
  const movement = order.movements[0];
  const pu = order.stops.find((s) => normalize(s.stop_type) === "PU");
  const so = order.stops.find((s) => normalize(s.stop_type) === "SO");
  if (!movement.id || !pu?.id || !so?.id || pu.id === so.id ||
      [pu, so].some((s) => String(s.order_id) !== row.order_id || String(s.movement_id) !== String(movement.id)) ||
      String(movement.origin_stop_id) !== String(pu.id) ||
      String(movement.dest_stop_id) !== String(so.id) ||
      (order.curr_movement_id && String(order.curr_movement_id) !== String(movement.id)))
    throw new Error("Saved movement and stop IDs do not match.");
  if (!['A', 'D'].includes(normalize(movement.status))) throw new Error("Movement status requires review.");
  const company = String(order.company_id ?? "");
  if (!company || [movement, pu, so].some((x) => x.company_id !== company))
    throw new Error("Order, movement and stop companies do not match.");
  const stops = [pu, so].map((s) => {
    const arrival = String(s.sched_arrive_early ?? ""), departure = String(s.sched_arrive_late ?? "");
    if (timestamp(arrival) > timestamp(departure)) throw new Error("Scheduled stop times are reversed.");
    if (!['A', 'D'].includes(normalize(s.status))) throw new Error("Stop status requires review.");
    for (const [field, expected] of [["actual_arrival", arrival], ["actual_departure", departure]])
      if (s[field] && timestamp(s[field]) !== timestamp(expected))
        throw new Error("Existing actual dates differ from schedule; review required.");
    return { id: String(s.id), type: normalize(s.stop_type), arrival, departure };
  });
  if (timestamp(stops[0].departure) > timestamp(stops[1].arrival)) throw new Error("Pickup is scheduled after delivery.");
  return { orderId: row.order_id!, movementId: String(movement.id), company, stops };
}
export function verifyDelivery(order: any, row: Ledger, plan: DeliveryPlan): string[] {
  const errors = verifyRatedOrder(order, row.invoice, row.profile);
  if (String(order.id) !== plan.orderId || order.company_id !== plan.company) errors.push("Order identity changed");
  if (normalize(order.status) !== "D" || ![true, 'Y'].includes(order.ready_to_bill)) errors.push("Order is not delivered and ready to bill");
  const m = order.movements?.[0];
  if (String(m?.id) !== plan.movementId || m?.company_id !== plan.company || normalize(m?.status) !== "D" || normalize(m?.brokerage_status) !== "FINISHED" ||
      String(m?.origin_stop_id) !== plan.stops[0].id || String(m?.dest_stop_id) !== plan.stops[1].id)
    errors.push("Movement delivery fields differ");
  for (const s of plan.stops) {
    const actual = order.stops?.find((x) => String(x.id) === s.id);
    if (!actual || actual.company_id !== plan.company || normalize(actual.stop_type) !== s.type || normalize(actual.status) !== "D" ||
        actual.actual_arrival !== s.arrival || actual.actual_departure !== s.departure ||
        actual.sched_arrive_early !== s.arrival || actual.sched_arrive_late !== s.departure)
      errors.push(`${s.type} actuals or schedule differ from reviewed plan`);
  }
  return errors;
}
const note = (plan: DeliveryPlan, error?: string) => JSON.stringify({ deliveryPlan: plan, ...(error ? { error: error.slice(0, 500) } : {}) });
export async function deliverInvoice(row: Ledger, store: Store, vendor: Vendor, expectedPlan: DeliveryPlan) {
  if (row.status === "delivered") return;
  if (row.status !== "verified") throw new Error("Only verified orders can be delivered. Reconcile uncertain delivery first.");
  const before = await vendor.read("/orders/" + encodeURIComponent(row.order_id!));
  const plan = buildDeliveryPlan(before, row);
  if (JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new Error("Delivery details changed. Review a fresh preview.");
  const held = await store.claim(row.id, "verified", "delivering", note(plan));
  if (!held) throw new Error("This delivery was claimed by another request.");
  // The durable claim includes the exact schedule snapshot. Any partial/uncertain
  // vendor write stays fenced; reconciliation is read-only and never auto-retries.
  try {
    if (verifyDelivery(before, row, plan).length) {
      for (const stop of plan.stops) await vendor.write("/stop/update", {
        __type: "stop", company_id: plan.company, id: stop.id,
        actual_arrival: stop.arrival, actual_departure: stop.departure, status: "D",
      });
      await vendor.write("/movement/update", {
        __type: "movement", company_id: plan.company, id: plan.movementId,
        status: "D", brokerage_status: "FINISHED",
      });
      await vendor.write("/orders/updateRow", {
        __type: "orders", company_id: plan.company, id: plan.orderId,
        status: "D", ready_to_bill: true,
      });
    }
    const after = await vendor.read("/orders/" + encodeURIComponent(plan.orderId));
    const errors = verifyDelivery(after, row, plan);
    await store.finish(held, errors.length ? "delivery_uncertain" : "delivered", plan.orderId, note(plan, errors.join("; ")));
  } catch (e) {
    await store.finish(held, "delivery_uncertain", plan.orderId, note(plan, (e as Error).message));
    throw e;
  }
}
export async function reconcileDelivery(row: Ledger & { note?: string }, store: Store, vendor: Vendor) {
  if (!["delivering", "delivery_uncertain"].includes(row.status)) throw new Error("This row does not need delivery reconciliation.");
  const plan = JSON.parse(row.note || "{}").deliveryPlan as DeliveryPlan | undefined;
  if (!plan || plan.orderId !== row.order_id) throw new Error("Delivery snapshot unavailable; manual review required.");
  const order = await vendor.read("/orders/" + encodeURIComponent(plan.orderId));
  const errors = verifyDelivery(order, row, plan);
  await store.finish(row, errors.length ? "delivery_uncertain" : "delivered", plan.orderId, note(plan, errors.join("; ")));
}
