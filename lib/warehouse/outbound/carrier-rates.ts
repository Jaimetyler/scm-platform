export const rateItems = [
  { key: "base", label: "Base drayage", code: null },
  { key: "chassisDays", label: "Extra chassis days", code: null },
  { key: "chassisSplits", label: "Chassis splits", code: "CS" },
  { key: "stopoffs", label: "Stopoffs", code: null },
] as const;

export const accessorials = rateItems.filter(item => item.key !== "base");
type RateKey = typeof rateItems[number]["key"];
export type Quantities = Record<Exclude<RateKey, "base">, number>;
export type RateAmounts = Record<RateKey, { pay: number; bill: number }>;
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

export function parseRates(value: Record<string, { pay?: unknown; bill?: unknown }> | undefined) {
  return Object.fromEntries(rateItems.map(({ key, label }) => {
    const line = value?.[key];
    return [key, { pay: parseRateAmount(line?.pay, label), bill: parseRateAmount(line?.bill, label) }];
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

export function carrierPlanLines({ rate, quantities, basePayOverride }: CarrierPlan) {
  return rateItems.map(item => {
    const units = item.key === "base" ? 1 : quantities[item.key];
    const { pay: cardPay, bill } = rate.rates[item.key];
    const pay = item.key === "base" ? basePayOverride ?? cardPay : cardPay;
    return { ...item, units, payCode: item.code, billCode: item.code, pay, bill, payTotal: units * pay, billTotal: units * bill };
  }).filter(line => line.units > 0);
}
