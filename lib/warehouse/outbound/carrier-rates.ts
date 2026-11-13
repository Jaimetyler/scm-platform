export const rateItems = [
  { key: "base", label: "Base drayage", code: null },
  { key: "chassisDays", label: "Extra chassis days", code: null },
  { key: "chassisSplits", label: "Chassis splits", code: "CS" },
  { key: "stopoffs", label: "Stopoffs", code: null },
] as const;

export const accessorials = rateItems.filter(item => item.key !== "base");
type RateKey = typeof rateItems[number]["key"];
export type Quantities = Record<Exclude<RateKey, "base">, number>;
export type RateAmounts = Record<RateKey, { pay: number }>;
export type CustomerBillRates = Record<RateKey, number | null> & { minimumChassisDays?: number };
export type CarrierRate = {
  id: string;
  carrier_id: string;
  carrier_name: string;
  lane: string;
  rates: RateAmounts;
  updated_at: string;
};
export type CarrierPlan = { rate: CarrierRate; quantities: Quantities; basePayOverride?: number | null };

export function parseRateAmount(amount: unknown, label: string) {
  if (typeof amount !== "string" || !/^\d{1,6}(?:\.\d{1,2})?$/.test(amount.trim())) {
    throw new Error(`Enter a dollar amount for ${label}, including 0 when applicable.`);
  }
  return Math.round(Number(amount) * 100);
}

export function parseRates(value: Record<string, { pay?: unknown }> | undefined) {
  return Object.fromEntries(rateItems.map(({ key, label }) => {
    const line = value?.[key];
    return [key, { pay: parseRateAmount(line?.pay, label) }];
  })) as RateAmounts;
}

export function parseQuantities(value: Record<string, unknown> | undefined) {
  return Object.fromEntries(accessorials.map(({ key, label }) => {
    const count = value?.[key];
    if (typeof count !== "string" || !/^\d{1,3}$/.test(count)) {
      throw new Error(`Enter a whole number from 0 to 999 for ${label.toLowerCase()}.`);
    }
    return [key, Number(count)];
  })) as Quantities;
}

export function carrierPlanLines({ rate, quantities, basePayOverride }: CarrierPlan, billing?: CustomerBillRates | null) {
  return rateItems.map(item => {
    const units = item.key === "base" ? 1 : quantities[item.key];
    const { pay: cardPay } = rate.rates[item.key];
    const bill = billing?.[item.key] ?? null;
    const pay = item.key === "base" ? basePayOverride ?? cardPay : cardPay;
    const billUnits = item.key === "chassisDays" ? Math.max(units, billing?.minimumChassisDays ?? 0) : units;
    return { ...item, units, billUnits, payCode: item.code, billCode: item.code, pay, bill, payTotal: units * pay, billTotal: bill == null ? null : billUnits * bill };
  }).filter(line => line.units > 0 || line.billUnits > 0);
}

export type CarrierSelection = { rateId: string; rateVersion: string; quantities: Record<string, string>; basePayOverride: string };
export type CarrierBatchAction = { rate: CarrierRate } | { charges: Quantities };

export function carrierBatchSelection(plan: CarrierPlan | null, action: CarrierBatchAction): CarrierSelection {
  const rate = "rate" in action ? plan?.rate.id === action.rate.id ? plan.rate : action.rate : plan?.rate;
  if (!rate) throw Error("Assign a carrier before adding charges.");
  const quantities = Object.fromEntries(accessorials.map(({ key }) => [key, String(plan?.quantities[key] ?? 0)]));
  if ("charges" in action) {
    for (const { key, label } of accessorials) {
      const units = action.charges[key];
      const total = Number(quantities[key]) + units;
      if (!Number.isInteger(units) || units < 0 || !Number.isInteger(total) || total > 999) {
        throw Error(`${label} must be a whole number. A container can have up to 999 units per charge.`);
      }
      quantities[key] = String(total);
    }
  }
  return {
    rateId: rate.id, rateVersion: rate.updated_at, quantities,
    basePayOverride: plan?.rate.id === rate.id && plan.basePayOverride != null ? (plan.basePayOverride / 100).toFixed(2) : "",
  };
}

export function carrierPlanTotals(plan: CarrierPlan, billing?: CustomerBillRates | null) {
  return carrierPlanLines(plan, billing).reduce<{ pay: number; bill: number | null }>((total, line) => ({
    pay: total.pay + line.payTotal,
    bill: total.bill == null || line.billTotal == null ? null : total.bill + line.billTotal,
  }), { pay: 0, bill: 0 });
}
