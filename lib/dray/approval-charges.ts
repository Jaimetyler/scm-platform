import type { FuelMode } from "./service-rates.ts";

type Charge = { units?: number | null; code: string; description: string; amount: number | null };
export type ApprovalRate = { includedChassisDays: number; chassisDailyRate: number; fuelMode?: FuelMode; baseRate?: number | null };
const fuel = (charge: Charge) => /^(?:FSC|FUEL)$/i.test(charge.code.trim()) ||
  /\bFSC\b|\bfuel\s+(?:sur(?:charge)?|surcharge)\b/i.test(charge.description);
const chassis = (charge: Charge) => /^(?:CHAS|CHASSIS)$/i.test(charge.code.trim()) || /\bchassis\b/i.test(charge.description);

// One allowance per order, even when McLeod splits chassis over several lines.
export function approvalCharges<T extends Charge>(total: number | null, charges: T[] | null, rate?: ApprovalRate | null, negotiatedFuel = true) {
  let allowance = rate ? Math.round(rate.includedChassisDays * rate.chassisDailyRate * 100) : 0;
  let remainingDays = rate?.includedChassisDays ?? 0;
  let includedChassis = 0;
  const standardFuel = rate?.fuelMode ? rate.fuelMode === "base_plus_fsc" : negotiatedFuel;
  const nonFuel = (charges ?? []).filter(charge => !standardFuel || !fuel(charge));
  const extras = nonFuel.flatMap(charge => {
    const cents = charge.amount === null ? null : Math.round(charge.amount * 100);
    let includedAmount = 0;
    if (rate && chassis(charge) && cents !== null && cents > 0 && remainingDays > 0 && allowance > 0) {
      const dailyCents = Math.round(rate.chassisDailyRate * 100);
      if (charge.units != null && Number.isFinite(charge.units) && charge.units > 0) {
        const includedDays = Math.min(remainingDays, charge.units);
        includedAmount = Math.min(allowance, Math.round(includedDays * Math.min(dailyCents, cents / charge.units)));
        remainingDays -= includedDays;
      } else {
        includedAmount = Math.min(allowance, cents, Math.round(remainingDays * dailyCents));
        remainingDays -= includedAmount / dailyCents;
      }
    }
    allowance -= includedAmount;
    includedChassis += includedAmount;
    if (cents !== null && cents - includedAmount === 0) return [];
    return [{ ...charge, amount: cents === null ? null : (cents - includedAmount) / 100, includedAmount: includedAmount / 100 }];
  });
  const complete = charges !== null && charges.every(charge => charge.amount !== null);
  const allIn = total === null || !complete ? null :
    (Math.round(total * 100) - nonFuel.reduce((sum, charge) => sum + Math.round(charge.amount! * 100), 0)) / 100;
  const extraTotal = complete ? extras.reduce((sum, charge) => sum + Math.round(charge.amount! * 100), 0) / 100 : null;
  const fuelLines = standardFuel && complete ? (charges ?? []).filter(fuel) : [];
  const fuelCents = fuelLines.reduce((sum, charge) => sum + Math.round(charge.amount! * 100), 0);
  const billedFsc = fuelLines.length ? fuelCents / 100 : null;
  const baseVariance = allIn === null || rate?.baseRate == null ? null :
    (Math.round(allIn * 100) - fuelCents - Math.round(rate.baseRate * 100)) / 100;
  return { extras, allIn, baseVariance, billedFsc, includedChassis: includedChassis / 100,
    standardTotal: allIn === null ? null : (Math.round(allIn * 100) + includedChassis) / 100, extraTotal };
}

export function compareApprovalOrders(a: { extraTotal: number | null; total: number | null }, b: { extraTotal: number | null; total: number | null }) {
  return Number((b.extraTotal ?? 0) > 0) - Number((a.extraTotal ?? 0) > 0) ||
    (b.total ?? -Infinity) - (a.total ?? -Infinity) || (b.extraTotal ?? 0) - (a.extraTotal ?? 0);
}

export function defaultApprovalSelection<T extends Charge>(
  orders: { id: string; total: number | null; charges: T[] | null }[],
  rate: ApprovalRate | null, negotiatedFuel: boolean,
) {
  const selected = new Set<string>();
  if (!rate) return selected;
  const seen = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const breakdown = approvalCharges(order.total, order.charges, rate, negotiatedFuel);
    if (breakdown.extraTotal !== null && breakdown.extraTotal > 0) selected.add(order.id);
  }
  return selected;
}
