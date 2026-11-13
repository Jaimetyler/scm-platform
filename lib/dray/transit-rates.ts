import { COTTON_DELIVERY_LOCATIONS } from "../bunge/destinations.ts";
import { parseRateAmount } from "../warehouse/outbound/carrier-rates.ts";

export type TransitRateSide = "customer" | "carrier";
export const transitColumns = ["account_code", "account_name", "pickup_city", "pickup_state", "delivery_code", "flat_rate"] as const;
export const transitCityKey = (city: string) => city.trim().replace(/\s+/g, " ").toUpperCase();

export function normalizeTransitRate(row: Record<string, unknown>) {
  const field = (name: string) => String(row[name] ?? "").trim();
  const account_code = field("account_code").toUpperCase();
  const account_name = field("account_name");
  const pickup_city = transitCityKey(field("pickup_city"));
  const pickup_state = field("pickup_state").toUpperCase();
  const delivery_code = field("delivery_code").toUpperCase();
  if (!/^[A-Z0-9_-]{1,30}$/.test(account_code) || account_name.length > 100) throw Error("Enter a valid McLeod account code and name.");
  if (!pickup_city || pickup_city.length > 100 || !/^[A-Z]{2}$/.test(pickup_state)) throw Error("Enter the pickup city and a two-letter state code.");
  if (!COTTON_DELIVERY_LOCATIONS.some(location => location.code === delivery_code)) throw Error("Enter a delivery code supported by the inbound cotton importer.");
  return { account_code, account_name, pickup_city, pickup_state, delivery_code,
    flat_cents: parseRateAmount(field("flat_rate").replace(/^\$\s*/, ""), "flat rate per load") };
}
export type TransitRate = ReturnType<typeof normalizeTransitRate> & { id: string; updated_at: string };
