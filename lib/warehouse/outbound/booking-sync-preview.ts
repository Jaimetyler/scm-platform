import { bookingOrderCharges } from "../../dray/booking-charges.ts";
import { carrierPlanLines, type CarrierPlan, type CustomerBillRates } from "./carrier-rates.ts";

type Order = Record<string, any>;
export type PreviewLoad = {
  id: string;
  sequence: number;
  mark: string | null;
  container: string | null;
  plan: CarrierPlan | null;
  savedOrderId?: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => text(value).toUpperCase();
const markReference = (value: unknown) =>
  key(value).replace(/\s+\d+\s+(?:BALES?|B\/?C)$/i, "");
const money = (value: unknown) =>
  (typeof value === "string" || typeof value === "number") && text(value) && Number.isFinite(Number(value)) ? Number(value) : null;

function carrierPayLines(movement: Order | undefined) {
  const lines = movement?.otherCarrierPay ?? movement?.other_carrier_pay ??
    movement?.otherPay ?? movement?.other_pay ?? movement?.otherPays;
  if (!Array.isArray(lines) || lines.some(line => !line || typeof line !== "object")) return null;
  return lines.map(line => ({
    id: text(line.id),
    code: text(line.charge_id ?? line.pay_code_id ?? line.code),
    description: text(line.descr ?? line.description),
    amount: money(line.amount ?? line.pay_amount ?? line.pay_amt),
  }));
}

function summarizeOrder(order: Order) {
  const movements: Order[] = Array.isArray(order.movements) ? order.movements : [];
  const movementId = text(order.warehousePickup?.movement_id ?? order.curr_movement_id);
  const movement = movementId ? movements.find(item => text(item.id) === movementId) :
    movements.length === 1 ? movements[0] : undefined;
  return {
    ...bookingOrderCharges(order),
    blnum: text(order.blnum),
    container: text(order.consignee_refno),
    carrier: text(movement?.carrier_id || movement?.vendor_id || movement?.override_payee_id),
    basePay: money(movement?.override_pay_amt),
    otherPay: carrierPayLines(movement),
  };
}

export function buildBookingSyncPreview(
  loads: PreviewLoad[], orders: Order[], bookId: string, billing: CustomerBillRates | null,
) {
  const candidates = loads.map(load => {
    if (load.savedOrderId) return orders.filter(order => text(order.id) === load.savedOrderId);
    const numbered = key(bookId) ? key(`${bookId}-${load.sequence}`) : "";
    const direct = orders.filter(order =>
      (numbered && key(order.blnum) === numbered) ||
      (key(load.container) && key(order.consignee_refno) === key(load.container)));
    if (direct.length || !key(load.mark)) return direct;
    return orders.filter(order => markReference(order.blnum) === key(load.mark) ||
      markReference(order.consignee_refno) === key(load.mark));
  });
  const claims = new Map<string, number>();
  for (const matches of candidates) {
    for (const order of matches) claims.set(text(order.id), (claims.get(text(order.id)) ?? 0) + 1);
  }
  const linked = new Set<string>();
  const rows = loads.map((load, index) => {
    const matches = candidates[index];
    const candidate = matches.length === 1 ? matches[0] : null;
    const order = candidate && claims.get(text(candidate.id)) === 1 ? summarizeOrder(candidate) : null;
    if (order) linked.add(order.id);
    const lines = load.plan ? carrierPlanLines(load.plan, billing) : [];
    const base = lines.find(line => line.key === "base");
    return {
      id: load.id,
      sequence: load.sequence,
      platform: {
        mark: load.mark,
        container: load.container,
        carrier: load.plan?.rate.carrier_id ?? null,
        basePay: base ? base.payTotal / 100 : null,
        otherPay: load.plan ? lines.filter(line => line.key !== "base" && line.units > 0)
          .map(line => ({ code: line.payCode, description: line.label, amount: line.payTotal / 100 })) : null,
        customerCharges: billing && load.plan ? lines.map(line => ({
          description: line.label, amount: line.billTotal == null ? null : line.billTotal / 100,
        })) : null,
      },
      order,
      issue: order ? null : matches.length ? "Ambiguous order match" :
        load.savedOrderId ? "Saved SCM order could not be verified" : "No verified order match",
    };
  });
  return { rows, unmatchedOrders: orders.filter(order => !linked.has(text(order.id))).map(summarizeOrder) };
}

export type BookingSyncPreview = ReturnType<typeof buildBookingSyncPreview>;
