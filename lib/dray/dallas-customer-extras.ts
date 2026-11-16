import type { CarrierPlan } from "../warehouse/outbound/carrier-rates";

type CustomerRates = {
  included_chassis_days: number | string | null;
  chassis_daily_rate: number | string | null;
  chassis_split_rate: number | string | null;
  stopoff_rate: number | string | null;
};

export type CustomerCharge = {
  id: string;
  code: string;
  description: string;
  units: number;
  rate: number;
  amount: number | null;
  inclusion: unknown;
};

export function planDallasCustomerExtras(quantities: CarrierPlan["quantities"], rates: CustomerRates | null,
  billed: CustomerCharge[] | null, customerSuppliesChassis: boolean) {
  const minimum = Number(rates?.included_chassis_days ?? 0);
  const specs = [
    { code: "DSCM", description: "DAL Chassis Charges", units: quantities.chassisDays, rate: rates?.chassis_daily_rate },
    { code: "CS", description: "Chassis Split", units: quantities.chassisSplits, rate: rates?.chassis_split_rate },
    { code: "006", description: "Stop Off Charge", units: quantities.stopoffs, rate: rates?.stopoff_rate },
  ];
  const charges = specs.filter(line => line.code === "DSCM" ? !customerSuppliesChassis && line.units > minimum : line.units > 0);
  const blockers: string[] = [];
  if (charges.length && billed === null) return { changes: [], blockers: ["McLeod customer charges could not be verified."] };

  const changes = charges.flatMap(line => {
    const existing = (billed ?? []).filter(row => row.code === line.code);
    if (line.code !== "DSCM" && existing.length) return [];
    if (line.code === "DSCM" && existing.length &&
        existing.every(row => Number.isFinite(row.units) && row.units >= 0) &&
        existing.reduce((sum, row) => sum + row.units, 0) >= line.units) return [];

    const rate = Number(line.rate);
    if (line.rate == null || !String(line.rate).trim() || !Number.isFinite(rate) || rate < 0) {
      blockers.push(`Customer rate missing or invalid for ${line.description}. Check Customer Rates for this warehouse and return lane.`);
      return [];
    }
    if (rate === 0) return [];

    if (line.code === "DSCM" && minimum > 0 && !existing.length) {
      blockers.push("The standard DSCM charge is missing in McLeod. Apply the customer minimum before adding extra chassis days.");
      return [];
    }

    const previous = existing[0] ?? null;
    if (previous && (existing.length !== 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(previous.id) ||
        previous.inclusion !== "N" || !Number.isFinite(previous.units) || previous.units < minimum ||
        previous.amount === null || previous.rate !== rate ||
        Math.round(previous.amount * 100) !== Math.round(previous.units * rate * 100))) {
      blockers.push("The existing DSCM charge could not be safely increased. Check its units, rate, and freight setting in McLeod.");
      return [];
    }

    return [{ code: line.code, description: previous?.description || line.description, units: line.units, rate,
      amount: Math.round(rate * line.units * 100) / 100, previous }];
  });
  return { changes, blockers };
}
