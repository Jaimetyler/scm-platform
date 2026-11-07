type Charge = { code: string; description: string; amount: number | null };

// Keep negotiated fuel in the base amount; McLeod remains authoritative for totals.
export function approvalCharges<T extends Charge>(total: number | null, charges: T[] | null) {
  const extras = (charges ?? []).filter(charge =>
    !/^(?:FSC|FUEL)$/i.test(charge.code.trim()) &&
    !/\bFSC\b|\bfuel\s+(?:sur(?:charge)?|surcharge)\b/i.test(charge.description));
  const allIn = total === null || charges === null || charges.some(charge => charge.amount === null)
    ? null : (Math.round(total * 100) - extras.reduce((sum, charge) => sum + Math.round(charge.amount! * 100), 0)) / 100;
  return { extras, allIn };
}
