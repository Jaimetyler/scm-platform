import type { Staff } from "./policy";

export function isWarehouseLevelOne(staff: Staff | null | undefined) {
  return staff?.role === "operator" && staff.warehouse_level === 1;
}
export function canViewFinancialAmounts(staff: Staff | null | undefined) {
  return Boolean(staff?.status === "active" && !isWarehouseLevelOne(staff));
}
export type CarrierOperationalSummary = {
  carrierName: string;
  carrierId: string;
  quantities: { chassisDays: number; chassisSplits: number; stopoffs: number };
};
export function carrierOperationalSummary(plan: any): CarrierOperationalSummary | null {
  if (!plan?.rate) return null;
  return {
    carrierName: String(plan.rate.carrier_name ?? ""), carrierId: String(plan.rate.carrier_id ?? ""),
    quantities: {
      chassisDays: Number(plan.quantities?.chassisDays ?? 0),
      chassisSplits: Number(plan.quantities?.chassisSplits ?? 0),
      stopoffs: Number(plan.quantities?.stopoffs ?? 0),
    },
  };
}
const privateKeys = new Set([
  "rate", "rates", "rate_type", "rate_units", "amount", "cents", "baseCents", "carrierCents",
  "pay", "bill", "total_charge", "total_charge_c", "total_charge_n", "otherchargetotal",
  "customerBilling", "billingCharges", "carrier_plan", "basePayOverride", "payTotal", "billTotal",
  "base_rate", "chassis_daily_rate", "chassis_split_rate", "stopoff_rate",
  "base_pay", "all_in_pay", "all_in_bill", "carrier_pay", "customer_bill",
]);
export function redactFinancialAmounts(value: unknown): any {
  if (Array.isArray(value)) return value.map(redactFinancialAmounts);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).filter(([key]) =>
    !privateKeys.has(key) && !/^override_pay|^(?:previous|proposed)(?:Pay|Bill)|(?:_rate|_amount|_cents)$/.test(key));
  const result = Object.fromEntries(entries.map(([key, item]) => [key, redactFinancialAmounts(item)]));
  if (record.carrier_plan) result.carrier_summary = carrierOperationalSummary(record.carrier_plan);
  return result;
}
