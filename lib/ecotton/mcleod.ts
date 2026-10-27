import { extractSearchOrders } from "../mcleod/inbound/search-response.ts";
import { money, normalize, type Invoice, type Profile } from "./model.ts";
export type Reader = (path: string) => Promise<any>;
export function dateStamp(date: string, timezone: string) {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = offset?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!m) throw new Error("Warehouse date offset unavailable.");
  return (
    date.replace(/-/g, "") +
    "000000" +
    m[1] +
    m[2].padStart(2, "0") +
    (m[3] || "00")
  );
}
export function buildPayload(invoice: Invoice, profile: Profile) {
  if (!profile.confirmed || !profile.location || !profile.payee)
    throw new Error("Creation profile requires confirmed terminal defaults.");
  const date = dateStamp(invoice.invoiceDate, profile.timezone);
  return {
    __type: "orders",
    company_id: "TMS",
    status: "A",
    customer_id: invoice.customerId,
    blnum: invoice.reference,
    consignee_refno: invoice.mark,
    planning_comment: (invoice.cents / 100).toFixed(2),
    ordered_by: profile.orderedBy,
    order_type_id: profile.orderType,
    revenue_code_id: profile.revenue,
    commodity_id: profile.commodity,
    equipment_type_id: profile.equipment,
    order_mode: profile.mode,
    collection_method: "T",
    rate_type: "F",
    rate_units: 1,
    rate: 0,
    stops: ["PU", "SO"].map((stop_type, i) => ({
      __type: "stop",
      __name: "stops",
      company_id: "TMS",
      stop_type,
      status: "A",
      order_sequence: i + 1,
      location_id: profile.location,
      sched_arrive_early: date,
      sched_arrive_late: date,
    })),
    movements: [
      {
        __type: "movement",
        __name: "movements",
        company_id: "TMS",
        override_payee_id: profile.payee,
        override_type: "F",
        override_units: 1,
        override_paye_rate: 0,
        override_pay_rate: 0,
        override_pay_amt: 0,
      },
    ],
    otherCharges: invoice.charges.map((c) => ({
      __type: "other_charge",
      __name: "otherCharges",
      company_id: "TMS",
      charge_id: c.code,
      descr: c.description.slice(0, 28),
      units: c.units,
      rate: Math.round((c.cents / 100 / c.units) * 10000) / 10000,
      amount: c.cents / 100,
      incl_in_freight: "N",
      bill_type: "F",
      calc_method: "F",
    })),
  };
}
export function atWarehouse(order: any, profile: Profile): boolean {
  if (
    !Array.isArray(order?.stops) ||
    order.stops.length !== 2 ||
    !order.stops.every((s) => normalize(s.location_id))
  )
    throw new Error("Order stop locations could not be verified.");
  return (
    order.stops.every((s) => normalize(s.location_id) === profile.location) &&
    order.stops.filter((s) => normalize(s.stop_type) === "PU").length === 1 &&
    order.stops.filter((s) => normalize(s.stop_type) === "SO").length === 1
  );
}
function dateOnly(v: unknown) {
  const s = String(v ?? "");
  return /^\d{8}/.test(s) ? s.slice(0, 8) : s.slice(0, 10).replace(/-/g, "");
}
export function identityMatches(
  order: any,
  invoice: Invoice,
  profile: Profile,
) {
  return (
    normalize(order.blnum) === normalize(invoice.reference) &&
    normalize(order.customer_id) === invoice.customerId &&
    normalize(order.consignee_refno) === normalize(invoice.mark) &&
    normalize(order.order_type_id) === profile.orderType &&
    normalize(order.revenue_code_id) === profile.revenue &&
    atWarehouse(order, profile) &&
    order.stops.every(
      (s) =>
        dateOnly(s.sched_arrive_early) ===
        invoice.invoiceDate.replace(/-/g, ""),
    )
  );
}
export async function findDuplicates(
  read: Reader,
  invoice: Invoice,
  profile: Profile,
) {
  const found = new Map<string, any>(),
    seen = new Set<string>();
  for (let offset = 0; offset < 100; offset += 5) {
    const q = new URLSearchParams({
      "orders.blnum": invoice.reference,
      "orders.order_type_id": profile.orderType,
      "orders.revenue_code_id": profile.revenue,
      recordLength: "5",
      recordOffset: String(offset),
    });
    const data = await read("/orders/search?" + q);
    const rows = extractSearchOrders(data);
    if (!Array.isArray(rows) || rows.length > 5)
      throw new Error("Unrecognized McLeod search response; creation blocked.");
    let progress = 0;
    for (const row of rows) {
      const id = String((row as any)?.id ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(id))
        throw new Error("Invalid McLeod order ID.");
      if (seen.has(id)) continue;
      seen.add(id);
      progress++;
      const order = await read("/orders/" + encodeURIComponent(id));
      if (String(order?.id) !== id)
        throw new Error("McLeod order hydration failed.");
      if (normalize(order.blnum) !== normalize(invoice.reference)) continue;
      if (
        normalize(order.order_type_id) !== profile.orderType ||
        normalize(order.revenue_code_id) !== profile.revenue
      )
        continue;
      if (atWarehouse(order, profile)) found.set(id, order);
    }
    if (rows.length < 5) return [...found.values()];
    if (!progress)
      throw new Error(
        "McLeod search pagination did not advance; creation blocked.",
      );
  }
  throw new Error("McLeod duplicate search incomplete; creation blocked.");
}
export function verifyRatedOrder(
  order: any,
  invoice: Invoice,
  profile: Profile,
): string[] {
  const errors: string[] = [];
  if (!identityMatches(order, invoice, profile))
    errors.push("Order identity, dates or locations differ");
  try {
    if (money(order.planning_comment) !== invoice.cents)
      errors.push("Expected invoice total differs from planning comment");
  } catch {
    errors.push("Expected invoice total missing from planning comment");
  }
  const charges = order.otherCharges ?? order.other_charges;
  if (!Array.isArray(charges)) {
    errors.push("Charges unavailable");
    return errors;
  }
  const signature = (c: any) =>
    JSON.stringify([
      normalize(c.charge_id),
      String(c.descr ?? c.description ?? "").trim(),
      Number(c.units),
      Math.round(Number(c.amount) * 100),
    ]);
  const expected = invoice.charges
    .map((c) =>
      signature({
        charge_id: c.code,
        descr: c.description.slice(0, 28),
        units: c.units,
        amount: c.cents / 100,
      }),
    )
    .sort();
  const actual = charges.map(signature).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    errors.push("Charge lines differ from source invoice");
  if (
    !Number.isFinite(Number(order.total_charge)) ||
    Math.round(Number(order.total_charge) * 100) !== invoice.cents
  )
    errors.push("McLeod order total differs from source invoice");
  return errors;
}
