import { vendor } from "@/lib/dray/server";

type SourceRow = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => text(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const object = (value: unknown): SourceRow | undefined => value != null && typeof value === "object" ? value as SourceRow : undefined;

export async function salesOrdersApi(from: string, through: string, salesperson: string, page: number, pageSize: number) {
  const {read} = vendor(true);
  const query = new URLSearchParams({
    "orders.company_id": "TMS",
    orderBy: "orders.bill_date DESC,orders.id DESC",
    recordLength: String(pageSize),
    recordOffset: String((page - 1) * pageSize),
  });
  const source: unknown = await read(`/orders/search?${query}`);
  if (!Array.isArray(source) || source.length > pageSize) throw Error("Unexpected order search response.");

  let lastDate = "9999-12-31";
  let pastStart = false;
  const seen = new Set<string>();
  const candidates = source.flatMap((order: SourceRow) => {
    const raw = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(text(order.bill_date));
    if (!raw) return [];
    const billDate = raw.slice(1).join("-");
    const id = text(order.id);
    if (text(order.company_id) !== "TMS" || !/^\d+$/.test(id) || seen.has(id) || billDate > lastDate)
      throw Error("Order search returned an inconsistent page.");
    seen.add(id);
    lastDate = billDate;
    if (billDate < from) pastStart = true;
    return billDate >= from && billDate <= through ? [{order, id, billDate}] : [];
  });

  const customerIds = [...new Set(candidates.map(({order}) => text(order.customer_id)).filter(Boolean))];
  const customers = new Map<string, SourceRow>();
  let index = 0;
  await Promise.all(Array.from({length: Math.min(6, customerIds.length)}, async () => {
    while (index < customerIds.length) {
      const code = customerIds[index++];
      try {
        const customer = object(await read(`/customers/${encodeURIComponent(code)}`));
        if (customer && text(customer.id) === code && text(customer.company_id) === "TMS") customers.set(code, customer);
      } catch { /* Missing customer lookup is shown separately from unassigned. */ }
    }
  }));

  const people = [...new Set([...customers.values()].map(customer => text(customer.salesperson_id)).filter(Boolean))]
    .sort().map(value => ({salesperson: value}));
  const summaries = new Map<string, {salesperson: string; orders: number; revenue: number | null; recordedCarrierPay: number | null; comparableRevenue: number | null; margin: number | null; pending: number}>();
  const add = (total: number | null, value: number | null) => value == null ? total : (total ?? 0) + value;
  const payByOrder = new Map<string, number>();
  let movementIndex = 0;
  await Promise.all(Array.from({length: Math.min(8, candidates.length)}, async () => {
    while (movementIndex < candidates.length) {
      const {order, id} = candidates[movementIndex++];
      const movementId = text(order.curr_movement_id);
      if (!/^[A-Za-z0-9_-]+$/.test(movementId)) continue;
      const movements = order.movements ?? order.movement;
      const embedded = Array.isArray(movements)
        ? movements.find(item => text(object(item)?.id) === movementId) : undefined;
      let pay = money(object(embedded)?.override_pay_amt);
      if (pay == null) {
        try {
          const movement = object(await read(`/movements/${movementId}`));
          if (text(movement?.id) === movementId && (!movement?.company_id || text(movement.company_id) === "TMS"))
            pay = money(movement?.override_pay_amt);
        } catch { /* Leave unavailable amounts out of margin. */ }
      }
      if (pay != null) payByOrder.set(id, pay);
    }
  }));
  const orders = candidates.flatMap(({order, id, billDate}) => {
    const customerCode = text(order.customer_id);
    const customer = customers.get(customerCode);
    const rep = customer ? text(customer.salesperson_id) : "~unknown";
    if (salesperson && (salesperson === "~unassigned" ? rep !== "" : rep !== salesperson)) return [];
    const revenue = money(order.total_charge);
    const carrierPay = payByOrder.get(id) ?? null;
    const comparable = revenue != null && carrierPay != null;
    const row = summaries.get(rep) ?? {salesperson: rep, orders: 0, revenue: null, recordedCarrierPay: null, comparableRevenue: null, margin: null, pending: 0};
    row.orders++;
    row.revenue = add(row.revenue, revenue);
    row.recordedCarrierPay = add(row.recordedCarrierPay, carrierPay);
    row.comparableRevenue = add(row.comparableRevenue, comparable ? revenue : null);
    row.margin = add(row.margin, comparable ? revenue - carrierPay : null);
    if (!comparable) row.pending++;
    summaries.set(rep, row);
    return [{orderId: id, customerCode, customerName: text(customer?.name) || customerCode,
      salesperson: rep, billDate, status: text(order.status), revenue, carrierPay}];
  });
  return {people, summaries: [...summaries.values()], orders, pageSize, pageOnly: true, hasNext: !pastStart && source.length === pageSize};
}
