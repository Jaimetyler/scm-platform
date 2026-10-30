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
  if (
    normalize(order.rate_type) !== "F" ||
    Number(order.rate_units) !== 1 ||
    order.rate == null ||
    String(order.rate).trim() === "" ||
    Number(order.rate) !== 0
  )
    errors.push("Base linehaul settings differ from import defaults");
  if (
    normalize(order.collection_method) !== "T" ||
    normalize(order.commodity_id) !== profile.commodity ||
    normalize(order.equipment_type_id) !== profile.equipment ||
    normalize(order.order_mode) !== profile.mode ||
    normalize(order.ordered_by) !== profile.orderedBy
  )
    errors.push("Order defaults differ from approved profile");
  const movements = order.movements;
  if (
    !Array.isArray(movements) ||
    movements.length !== 1 ||
    movements.some(
      (m) =>
        normalize(m.override_payee_id) !== profile.payee ||
        normalize(m.override_type) !== "F" ||
        Number(m.override_units) !== 1 ||
        [m.override_paye_rate, m.override_pay_rate, m.override_pay_amt].some(
          (value) =>
            value == null ||
            String(value).trim() === "" ||
            !Number.isFinite(Number(value)) ||
            Number(value) !== 0,
        ),
    )
  )
    errors.push(
      "Movement payee or zero-payment settings differ from approved profile",
    );
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
    order.total_charge == null ||
    String(order.total_charge).trim() === "" ||
    !Number.isFinite(Number(order.total_charge)) ||
    Math.round(Number(order.total_charge) * 100) !== invoice.cents
  )
    errors.push("McLeod order total differs from source invoice");
  return errors;
}

/** McLeod create may generate a movement without applying nested movement overrides.
 * Only complete missing defaults on a newly-created, still-Available invoice order.
 * Never overwrite another carrier, a payment, a progressed stop, or other order data. */
export function movementDefaultsUpdate(
  order: any,
  invoice: Invoice,
  profile: Profile,
  expectedId: string,
) {
  const errors = verifyRatedOrder(order, invoice, profile).filter(
    (e) =>
      ![
        "Movement payee or zero-payment settings differ from approved profile",
        "McLeod order total differs from source invoice",
      ].includes(e),
  );
  if (
    String(order.id) !== expectedId ||
    normalize(order.status) !== "A" ||
    !Array.isArray(order.stops) ||
    order.stops.some(
      (s) =>
        normalize(s.status) !== "A" || s.actual_arrival || s.actual_departure,
    )
  )
    errors.push("Order has progressed or its identity changed");
  if (errors.length)
    throw new Error("Movement setup blocked: " + errors.join("; "));
  if (
    !Array.isArray(order.movements) ||
    order.movements.length !== 1 ||
    !order.movements[0].id
  )
    throw new Error("Expected one saved movement for setup.");
  const movement = order.movements[0];
  const blank = (v) => v == null || String(v).trim() === "";
  for (const field of ["override_payee_id", "carrier_id", "vendor_id"])
    if (!blank(movement[field]) && normalize(movement[field]) !== profile.payee)
      throw new Error(
        "Existing movement carrier differs; refusing to overwrite.",
      );
  if (
    !blank(movement.override_type) &&
    normalize(movement.override_type) !== "F"
  )
    throw new Error("Existing movement rate type differs.");
  if (!blank(movement.override_units) && Number(movement.override_units) !== 1)
    throw new Error("Existing movement units differ.");
  for (const field of [
    "override_paye_rate",
    "override_pay_rate",
    "override_pay_amt",
  ])
    if (!blank(movement[field]) && Number(movement[field]) !== 0)
      throw new Error(
        "Existing movement payment differs; refusing to overwrite.",
      );
  return {
    ...order,
    movements: [
      {
        ...movement,
        override_payee_id: profile.payee,
        override_type: "F",
        override_units: 1,
        override_paye_rate: 0,
        override_pay_rate: 0,
        override_pay_amt: 0,
      },
    ],
  };
}

// Documented TableRowService PUT /{table}/update. Send only the approved
// movement columns and its saved primary key; never replay order/stops/charges.
export function movementUpdatePayload(
  order: any,
  invoice: Invoice,
  profile: Profile,
  expectedId: string,
) {
  const fixed = movementDefaultsUpdate(order, invoice, profile, expectedId)
    .movements[0];
  return {
    __type: fixed.__type || "movement",
    company_id: fixed.company_id || "TMS",
    id: fixed.id,
    override_payee_id: fixed.override_payee_id,
    override_type: fixed.override_type,
    override_units: fixed.override_units,
    override_paye_rate: fixed.override_paye_rate,
    override_pay_rate: fixed.override_pay_rate,
    override_pay_amt: fixed.override_pay_amt,
  };
}
