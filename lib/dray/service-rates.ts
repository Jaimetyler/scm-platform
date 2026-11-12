import { bookingReturnLocation } from "../warehouse/outbound/return-location.ts";
import { CHECKIN_SITES } from "../inbound/checkin/sites.ts";

export const rateModes = ["drayage", "truckload", "handling", "storage"] as const;
export const fuelModes = {
  all_in: "All in",
  base_plus_fsc: "FSC",
  fuel_for_review: "FLAT",
} as const;
export type FuelMode = keyof typeof fuelModes;
export type ServiceRate = {
  terminal: string;
  site_code: string;
  customer_code: string;
  return_location: string;
  revenue_code: string;
  service_type: string;
  fuel_mode: FuelMode;
  base_rate: number | null;
  included_chassis_days: number;
  chassis_daily_rate: number;
  chassis_split_rate: number | null;
  stopoff_rate: number | null;
  active: boolean;
  notes: string | null;
};

export function rateReturnLocation(value: string) {
  const resolved = bookingReturnLocation(value);
  return resolved.return_location_code ?? resolved.return_location?.toUpperCase() ?? "";
}

export const rateColumns = ["terminal", "site_code", "customer_code", "revenue_code", "service_type",
  "return_location", "fuel_mode", "base_rate", "included_chassis_days", "chassis_daily_rate", "chassis_split_rate", "stopoff_rate", "active", "notes"] as const;

export function normalizeServiceRate(row: Record<string, unknown>): ServiceRate {
  const value = (field: string) => String(row[field] ?? "").trim();
  const terminal = value("terminal").toUpperCase();
  const siteInput = value("site_code").toUpperCase();
  const site = CHECKIN_SITES.find(item => item.terminal === terminal && (item.siteCode === siteInput || item.displayCode === siteInput));
  const customerCode = value("customer_code").toUpperCase();
  const revenueCode = value("revenue_code").toUpperCase();
  const mode = value("service_type").toLowerCase() as (typeof rateModes)[number];
  const inputFuelMode = value("fuel_mode").toLowerCase().replace(/\s+/g, "_");
  const fuelMode = (inputFuelMode === "fsc" ? "base_plus_fsc" : inputFuelMode === "flat" ? "fuel_for_review" : inputFuelMode) as FuelMode;
  if (!["DAL", "HOU", "SAV"].includes(terminal) ||
      (siteInput && !site))
    throw Error("Choose a terminal and a warehouse within it.");
  if (![customerCode, revenueCode].every(code => /^[A-Z0-9_-]{1,30}$/.test(code)))
    throw Error("Enter McLeod customer and revenue codes.");
  if (!rateModes.includes(mode) || !Object.hasOwn(fuelModes, fuelMode)) throw Error("Choose a mode and fuel treatment.");

  function money(field: string) {
    const raw = value(field);
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) throw Error(`Enter a valid ${field.replaceAll("_", " ")}.`);
    return Number(raw);
  }
  const days = Number(value("included_chassis_days"));
  if (!/^\d{1,3}$/.test(value("included_chassis_days")) || !Number.isInteger(days))
    throw Error("Enter the included chassis days, using 0 for none.");
  const daily = money("chassis_daily_rate")!;
  if (days > 0 && daily <= 0) throw Error("Enter a positive chassis daily rate when days are included.");
  const active = value("active").toLowerCase();
  if (active && !["true", "false"].includes(active)) throw Error("Active must be true or false.");
  const notes = value("notes");
  if (notes.length > 1000) throw Error("Keep notes to 1,000 characters.");
  return { terminal, site_code: site?.siteCode ?? "", customer_code: customerCode, revenue_code: revenueCode,
    return_location: rateReturnLocation(value("return_location")), service_type: mode, fuel_mode: fuelMode, base_rate: money("base_rate"), included_chassis_days: days,
    chassis_daily_rate: daily, chassis_split_rate: value("chassis_split_rate") ? money("chassis_split_rate") : null,
    stopoff_rate: value("stopoff_rate") ? money("stopoff_rate") : null, active: active !== "false", notes: notes || null };
}
