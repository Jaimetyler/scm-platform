import type { CarrierPlan, CustomerBillRates } from "../warehouse/outbound/carrier-rates";

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

    const saved = existing[0];
    const previous = saved ? { ...saved } : null;
    if (previous && previous.amount !== null) {
      if (!Number.isFinite(previous.rate)) previous.rate = rate;
      if (!Number.isFinite(previous.units) && previous.rate === rate) {
        const inferredUnits = Math.round(previous.amount * 100) / Math.round(rate * 100);
        if (Number.isInteger(inferredUnits)) previous.units = inferredUnits;
      }
    }
    if (previous && existing.length === 1 && previous.units >= line.units) return [];
    if (previous && (existing.length !== 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(previous.id) ||
        previous.inclusion !== "N" || !Number.isFinite(previous.units) || previous.units < minimum ||
        previous.amount === null || previous.rate !== rate ||
        Math.round(previous.amount * 100) !== Math.round(previous.units * rate * 100))) {
      blockers.push(`DSCM could not be increased. McLeod returned ${existing.length} line(s), units ${Number.isFinite(previous.units) ? previous.units : "blank"}, rate ${previous.rate}, amount ${previous.amount ?? "blank"}, freight flag ${previous.inclusion ?? "unverified"}. Customer rate is ${rate}, minimum ${minimum}.`);
      return [];
    }

    return [{ code: line.code, description: previous?.description || line.description, units: line.units, rate,
      amount: Math.round(rate * line.units * 100) / 100, previous }];
  });
  return { changes, blockers };
}

function numberField(value: unknown) {
  return (typeof value === "number" || typeof value === "string") && String(value).trim() && Number.isFinite(Number(value))
    ? Number(value) : null;
}

export function readDallasCustomerCharges(raw: unknown, baseCents: number, currentTotalCents: number) {
  if (!Array.isArray(raw) || raw.some(row => !row || !String(row.charge_id ?? "").trim())) return null;
  const lines: CustomerCharge[] = raw.map(row => {
    const units = numberField(row.units);
    const rate = numberField(row.rate);
    const flag = String(row.incl_in_freight ?? "").trim().toUpperCase();
    const inclusion = ["Y", "TRUE", "1"].includes(flag) ? "Y" : ["N", "FALSE", "0"].includes(flag) ? "N" : null;
    return {
      id: String(row.id ?? ""), code: String(row.charge_id).trim().toUpperCase(), description: String(row.descr ?? ""),
      amount: numberField(row.amount) ?? (units === null || rate === null ? null : Math.round(units * rate * 100) / 100),
      units: units ?? NaN, rate: rate ?? NaN, inclusion,
    };
  });
  const unclassified = lines.filter(row => row.inclusion === null);
  if (!unclassified.length || lines.some(row => row.amount === null)) return lines;
  const known = baseCents + lines.filter(row => row.inclusion === "N")
    .reduce((sum, row) => sum + Math.round(row.amount! * 100), 0);
  const unknown = unclassified.map(row => Math.round(row.amount! * 100));
  // Infer missing freight flags only when the order total identifies the treatment for every unclassified charge.
  if (unknown.some(cents => cents < 0)) return lines;
  const unknownTotal = unknown.reduce((sum, cents) => sum + cents, 0);
  const inferred = currentTotalCents === known + unknownTotal && unknownTotal > 0 ? "N" :
    currentTotalCents === known ? "Y" : null;
  return lines.map(row => row.inclusion === null ? { ...row, inclusion: row.amount === 0 ? "N" : inferred } : row);
}

export function dallasPendingBillExtras(plan: CarrierPlan, billing: CustomerBillRates, billed: CustomerCharge[] | null,
  steamshipLine?: string | null) {
  const dollars = (cents: number | null) => cents === null ? null : cents / 100;
  const customerSuppliesChassis = /^(?:MSC\b|MEDITERRANEAN SHIPPING COMPANY\b)/i.test(steamshipLine?.trim() ?? "");
  const { changes } = planDallasCustomerExtras(plan.quantities, {
    included_chassis_days: billing.minimumChassisDays ?? 0, chassis_daily_rate: dollars(billing.chassisDays),
    chassis_split_rate: dollars(billing.chassisSplits), stopoff_rate: dollars(billing.stopoffs),
  }, billed, customerSuppliesChassis);
  return changes.reduce((total, line) => total + Math.round(line.amount * 100) - Math.round((line.previous?.amount ?? 0) * 100), 0) / 100;
}
