import { readDallasCustomerCharges } from "./dallas-customer-extras";
import { lockDallasBilling, sameChargeValues } from "./dallas-billing-receipt";
import { readLinkedDallasOrder } from "./dallas-linked-order";
import { hash, vendor } from "./server";

export async function restoreDallasCustomerCharges(orderId: string, bookingNumber: string,
  link: Parameters<typeof readLinkedDallasOrder>[3], history: Awaited<ReturnType<typeof lockDallasBilling>>) {
  const receipt = history.receipt;
  if (!receipt) return;
  if (receipt.pendingReduction) throw Error("Finish syncing the customer charge reduction before unassigning.");
  const { read, write, deleteCustomerCharge } = vendor(false);
  const readOrder = () => readLinkedDallasOrder(read, orderId, bookingNumber, link);
  const rawCharges = (order: Awaited<ReturnType<typeof readOrder>>) => order.otherCharges ?? order.other_charges ?? order.otherCharge;
  const order = await readOrder();
  const base = Math.round(Number(order.rate) * Number(order.rate_units) * 100);
  if (order.status !== "A" || order.rate_type !== "F" || !String(order.rate ?? "").trim() ||
      !(Number(order.rate_units) > 0) || !Number.isFinite(base))
    throw Error("Customer charges can only be restored on an available McLeod order with a verified flat rate.");

  const raw = rawCharges(order);
  const charges = readDallasCustomerCharges(raw, base, Math.round(Number(order.total_charge) * 100));
  if (!charges || charges.some(row => row.amount === null || row.inclusion === null))
    throw Error("McLeod customer charges could not be verified before unassigning.");

  const changes = receipt.charges.flatMap(entry => {
    const rows = charges.filter(row => row.code === entry.code);
    if (!rows.length && !entry.original) return [];
    const [current] = rows;
    if (rows.length !== 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(current.id) ||
        (entry.original ? entry.original.id !== current.id : entry.chargeId !== current.id))
      throw Error(`McLeod ${entry.code} no longer matches the saved charge. Review it before unassigning.`);
    if (entry.original && sameChargeValues(entry.original.values, current)) return [];
    if (current.inclusion !== "N" || !entry.attempted.some(values => sameChargeValues(values, current)))
      throw Error(`McLeod ${entry.code} changed after the platform synced it. Review it before unassigning.`);
    return [{ entry, current }];
  });

  const currentTotal = Math.round(Number(order.total_charge) * 100);
  const currentRowsTotal = base + charges.reduce((sum, row) =>
    sum + (row.inclusion === "N" ? Math.round(row.amount! * 100) : 0), 0);
  if (!String(order.total_charge ?? "").trim() ||
      (currentTotal !== currentRowsTotal && currentTotal !== receipt.restoringFromTotal))
    throw Error("The existing McLeod bill total could not be reconciled before unassigning.");
  if (receipt.restoringFromTotal === undefined)
    await history.record({ ...receipt, restoringFromTotal: currentTotal });

  let state = order;
  for (const { entry, current } of changes) {
    const fresh = await readOrder();
    if (hash(rawCharges(fresh)) !== hash(rawCharges(state)) || fresh.status !== state.status ||
        fresh.rate !== state.rate || fresh.rate_type !== state.rate_type || fresh.rate_units !== state.rate_units ||
        fresh.total_charge !== state.total_charge)
      throw Error("McLeod billing changed during unassign. Reload and review the order.");
    if (entry.original) {
      const original = (rawCharges(fresh) as Record<string, unknown>[]).find(row => String(row.id) === current.id);
      await write("/other_charge/update", { ...original, __type: "other_charge", company_id: "TMS", id: current.id,
        order_id: orderId, ...entry.original.values, incl_in_freight: "N" });
    } else {
      await deleteCustomerCharge(current.id);
    }
    state = await readOrder();
    const remaining = rawCharges(state);
    if (!Array.isArray(remaining) || (!entry.original && remaining.some(row => String(row.id) === current.id)))
      throw Error(`McLeod did not verify restoration of ${entry.code}.`);
    const unrelated = (rows: Record<string, unknown>[]) => rows.filter(row => String(row.id) !== current.id);
    if (hash(unrelated(remaining)) !== hash(unrelated(rawCharges(fresh))) ||
        state.status !== order.status || state.rate !== order.rate ||
        state.rate_type !== order.rate_type || state.rate_units !== order.rate_units)
      throw Error("Another McLeod billing field changed during restoration. Review the bill before retrying.");
    if (entry.original) {
      const restored = remaining.find(row => String(row.id) === current.id);
      if (!restored || !sameChargeValues(entry.original.values, {
        units: Number(restored.units), rate: Number(restored.rate), amount: restored.amount == null ? null : Number(restored.amount),
      }))
        throw Error(`McLeod did not verify restoration of ${entry.code}.`);
    }
  }

  // Use the pre-write freight classification for unrelated legacy lines whose flag was omitted.
  const originalAmount = new Map(receipt.charges.map(entry => [entry.code, entry.original?.values.amount ?? 0]));
  const total = base + charges.reduce((sum, row) => sum + (row.inclusion === "N"
    ? Math.round((originalAmount.get(row.code) ?? row.amount!) * 100) : 0), 0);
  if (Math.round(Number(state.total_charge) * 100) !== total)
    await write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: orderId, total_charge: total / 100 });
  const final = await readOrder();
  if (Math.round(Number(final.total_charge) * 100) !== total || hash(rawCharges(final)) !== hash(rawCharges(state)))
    throw Error("McLeod did not verify the restored bill total and charge lines.");
}
