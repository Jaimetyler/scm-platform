export const dallasFuelCode = "FSCD";
type FuelRow = Record<string, unknown>;

export function planDallasFuelCorrection(order: { order_type_id?: unknown; status?: unknown }, charges: unknown) {
  const orderType = String(order.order_type_id ?? "").trim().toUpperCase();
  const fuelRows = Array.isArray(charges) ? (charges as FuelRow[]).filter(row =>
    row && /^(FSC|FSCD)$/i.test(String(row.charge_id ?? "").trim())) : [];
  const legacy = fuelRows.filter(row => String(row.charge_id).trim().toUpperCase() === "FSC");
  if (!legacy.length && orderType !== "FSC") return { types: false, fuel: null, issues: [] };
  if (order.status !== "A") return { types: false, fuel: null, issues: ["McLeod must show the order as available to correct Dallas fuel."] };
  if (!Array.isArray(charges) || (legacy.length && fuelRows.length !== 1))
    return { types: false, fuel: null, issues: ["Dallas fuel corrections require a verified charge list with a single fuel line."] };
  const fuel = legacy[0] ?? null;
  if (fuel && (!/^[A-Za-z0-9_-]{1,32}$/.test(String(fuel.id ?? "")) ||
      !String(fuel.amount ?? "").trim() || !Number.isFinite(Number(fuel.amount))))
    return { types: false, fuel: null, issues: ["McLeod did not return a verifiable ID and amount for the FSC line."] };
  return { types: orderType === "FSC", fuel, issues: [] };
}
