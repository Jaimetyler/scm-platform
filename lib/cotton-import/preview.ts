import { resolveCottonLocation, type CottonLocation } from "./location-resolution.ts";

export type CottonPickup = {
  locationCode: string;
  scheduledDate: string;
  scheduledTime?: string;
};
export type CottonImportInput = {
  customerId?: string;
  revenueCode: "MAIN" | "DAVIS";
  mark: string;
  baleCount: number;
  pickups: CottonPickup[];
  deliveryLocation?: string;
};
export type CottonOrderPreview = {
  customerId: string;
  revenueCode: "MAIN" | "DAVIS";
  blnum: string;
  commodity: "COTTON";
  deliveryLocation: string;
  pickupStops: { locationId: string; locationCode: string; timezone: string; scheduledDate: string; scheduledTime: string | null }[];
  requiresScheduleReview: boolean;
};

function required(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${field}`);
  return text;
}
function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value)
    throw new Error("Invalid scheduled pickup date");
  return value;
}
export function buildCottonOrderPreview(input: CottonImportInput, locations: readonly CottonLocation[]): CottonOrderPreview {
  if (!["MAIN", "DAVIS"].includes(input.revenueCode)) throw new Error("Unsupported cotton revenue code");
  const suppliedCustomer = String(input.customerId ?? "").trim().toUpperCase();
  if (suppliedCustomer && suppliedCustomer !== "BUNGOMNE")
    throw new Error("Bunge import requires McLeod customer BUNGOMNE.");
  const customerId = "BUNGOMNE";
  const mark = required(input.mark, "mark").replace(/\s+/g, " ").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 .\/-]*$/.test(mark)) throw new Error("Invalid mark");
  if (!Number.isSafeInteger(input.baleCount) || input.baleCount <= 0) throw new Error("Invalid bale count");
  const blnum = `${mark} ${input.baleCount} BALES`;
  if (blnum.length > 28) throw new Error("McLeod BLNUM exceeds 28 characters");
  if (!Array.isArray(input.pickups) || input.pickups.length < 1 || input.pickups.length > 2)
    throw new Error("Cotton imports require one or two pickup stops");
  const pickupStops = input.pickups.map((pickup) => {
    const location = resolveCottonLocation(pickup.locationCode, locations);
    const scheduledTime = pickup.scheduledTime?.trim() || null;
    if (scheduledTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime))
      throw new Error("Invalid scheduled pickup time");
    return { locationId: location.id, locationCode: location.mcleod_code, timezone: location.timezone!, scheduledDate: date(pickup.scheduledDate), scheduledTime };
  });
  return { customerId, revenueCode: input.revenueCode, blnum, commodity: "COTTON",
    deliveryLocation: input.deliveryLocation ?? "SAVAGAG2", pickupStops,
    requiresScheduleReview: pickupStops.some(stop => !stop.scheduledTime) };
}
