import { vendor } from "@/lib/dray/server";

type SourceRow = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => text(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const object = (value: unknown): SourceRow | undefined => value != null && typeof value === "object" ? value as SourceRow : undefined;

export async function salesOrdersApi(from: string, through: string, salesperson: string, offset: number, pageSize: number) {
  const {read} = vendor(true);
  const customers = new Map<string, SourceRow | null>();
  const candidates: {order: SourceRow; id: string; billDate: string; customer: SourceRow; rep: string}[] = [];
  const reps = new Set<string>();
  const seen = new Set<string>();
  const sourcePageSize = 50;
  const deadline = Date.now() + 25_000;
  let lastDate = "9999-12-31";
  let complete = false;
  for (let batch = 0; batch < 4 && !complete && candidates.length < pageSize && Date.now() < deadline; batch++) {
    const query = new URLSearchParams({
      "orders.company_id": "TMS",
      orderBy: "orders.bill_date DESC,orders.id DESC",
      recordLength: String(sourcePageSize),
      recordOffset: String(offset),
    });
    const source: unknown = await read(`/orders/search?${query}`);
    if (!Array.isArray(source) || source.length > sourcePageSize) throw Error("Unexpected order search response.");
    const rows = source.map((order: SourceRow) => {
      const raw = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(text(order.bill_date));
      if (!raw) return {end: true};
      const billDate = raw.slice(1).join("-");
      const id = text(order.id);
      if (text(order.company_id) !== "TMS" || !/^\d+$/.test(id) || seen.has(id) || billDate > lastDate)
        throw Error("Order search returned an inconsistent page.");
      seen.add(id);
      lastDate = billDate;
      if (billDate < from) return {end: true};
      const voided = /^(V|VOID|VOIDED|CANCELED|CANCELLED)$/i;
      if (billDate > through || voided.test(text(order.status)) || voided.test(text(order.__statusDescr))) return {};
      return {order, id, billDate, code: text(order.customer_id)};
    });
    const ids = [...new Set(rows.map(row => row.code).filter(code => code && !customers.has(code)))];
    let index = 0;
    await Promise.all(Array.from({length: Math.min(8, ids.length)}, async () => {
      while (index < ids.length) {
        const code = ids[index++];
        try {
          const customer = object(await read(`/customers/${encodeURIComponent(code)}`));
          customers.set(code, customer && text(customer.id) === code && text(customer.company_id) === "TMS" ? customer : null);
        } catch { customers.set(code, null); }
      }
    }));
    let consumed = 0;
    for (const row of rows) {
      consumed++;
      offset++;
      if (row.end) { complete = true; break; }
      const customer = customers.get(row.code);
      const rep = text(customer?.salesperson_id);
      if (!customer || !rep) continue;
      reps.add(rep);
      if (salesperson && rep !== salesperson) continue;
      candidates.push({order: row.order, id: row.id, billDate: row.billDate, customer, rep});
      if (candidates.length === pageSize) break;
    }
    if (source.length < sourcePageSize && consumed === source.length) complete = true;
  }
  const people = [...reps].sort().map(value => ({salesperson: value}));
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
  const orders = candidates.map(({order, id, billDate, customer, rep}) => {
    const customerCode = text(order.customer_id);
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
    return {orderId: id, customerCode, customerName: text(customer?.name) || customerCode,
      salesperson: rep, billDate, status: text(order.status), revenue, carrierPay};
  });
  return {people, summaries: [...summaries.values()], orders, pageSize, pageOnly: true, hasNext: !complete, nextOffset: offset};
}
