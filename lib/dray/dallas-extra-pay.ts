import { dateStamp } from "../ecotton/mcleod.ts";
import { warehouseDate } from "../inbound/checkin/geofence.ts";
import { carrierPlanLines, type CarrierPlan } from "../warehouse/outbound/carrier-rates.ts";

export const dallasExtraPayReference = "SCM-OUTBOUND";
export const dallasExtraPayDate = (now: Date) => dateStamp(warehouseDate(now, "DAL"), "America/Chicago");

export function dallasExtraPayLines(plan: CarrierPlan) {
  const codes = { chassisDays: "001", stopoffs: "002", chassisSplits: "CS" };
  return carrierPlanLines(plan).flatMap(line => line.key === "base" || line.units <= 0 || line.payTotal <= 0 ? [] : [{
    code: codes[line.key], description: line.label, amount: line.payTotal / 100, units: line.units, rate: line.pay / 100,
  }]);
}

export async function readDallasExtraPay(read: (path: string) => Promise<unknown>, movementId: string) {
  const payload = await read(`/movements/${encodeURIComponent(movementId)}/otherPay`);
  function unwrap(value: unknown, depth = 0): Record<string, unknown>[] | null {
    if (Array.isArray(value)) return value;
    if (depth > 2 || !value || typeof value !== "object") return null;
    const entries = Object.entries(value);
    if (entries.length !== 1 || !/^(?:data|response|result|rows|items|list|otherPay|driver_extra_pay|RowDriverExtraPay)$/i.test(entries[0][0]))
      return null;
    return unwrap(entries[0][1], depth + 1);
  }
  const rows = payload === null ? [] : unwrap(payload);
  if (!rows || rows.some(row => !row || typeof row.deduct_code_id !== "string" ||
      !String(row.amount ?? "").trim() || !Number.isFinite(Number(row.amount))))
    throw Error("McLeod Other Carrier Pay could not be verified.");
  const text = (value: unknown) => String(value ?? "").trim();
  return rows.map(row => ({ code: text(row.deduct_code_id), payee: text(row.payee_id).toUpperCase(), description: text(row.descr),
    amount: Number(row.amount), id: text(row.id), orderId: text(row.order_id), movementId: text(row.movement_id),
    reference: text(row.reference_no), units: Number(row.units), rate: Number(row.rate), transactionDate: text(row.transaction_date) }));
}

export function dallasExtraPayToRemove(rows: Awaited<ReturnType<typeof readDallasExtraPay>>,
  { orderId, movementId, payee, plan }: { orderId: string; movementId: string; payee: string; plan?: CarrierPlan | null }) {
  const expected = plan ? dallasExtraPayLines(plan) : [];
  const matches = rows.filter(row => row.orderId === orderId && row.movementId === movementId && row.payee === payee &&
    (row.reference === dallasExtraPayReference || (!row.reference && expected.some(line =>
      row.code === line.code && (row.description === line.description ||
        (row.code === "001" && row.description === "Extra chassis days")) && row.units === line.units && row.rate === line.rate &&
      Math.round(row.amount * 100) === Math.round(line.amount * 100)))));
  if (matches.some(row => !/^[A-Za-z0-9_-]{1,32}$/.test(row.id) ||
      matches.filter(candidate => candidate.code === row.code).length !== 1 ||
      rows.filter(candidate => candidate.id === row.id).length !== 1))
    throw Error("Could not uniquely identify the Dallas Other Carrier Pay lines in McLeod.");
  return matches;
}
