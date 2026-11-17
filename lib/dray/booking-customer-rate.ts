import type { staffDatabase } from "../auth/session";
import { bookingChargeCustomer } from "./booking-customers";
import { rateReturnLocation } from "./service-rates";

type BookingScope = { terminal: string; site_code: string; customer: string; return_location_code?: string | null; return_location?: string | null };

export async function readBookingCustomerRate(db: ReturnType<typeof staffDatabase>, booking: BookingScope) {
  const customer = bookingChargeCustomer(booking.customer, booking.terminal);
  if (!["DAL", "HOU"].includes(booking.terminal) || !customer) return null;
  const sites = [booking.site_code, ""];
  const destinations = [...new Set([booking.return_location_code, booking.return_location]
    .map(location => rateReturnLocation(location ?? "")).filter(Boolean))];
  // Houston rate cards group port and rail deliveries separately.
  if (booking.terminal === "HOU") {
    const port = destinations.some(location => /^(?:HOUPORT|HOUSTON (?:BAYPORT|BARBOURS CUT|BARBOURS CUT TERMINAL))$/.test(location));
    if (port && !destinations.includes("HOUPORT")) destinations.push("HOUPORT");
  }
  const { data, error } = await db.from("customer_service_rates")
    .select("rate_code,return_location,site_code,included_chassis_days,chassis_daily_rate,chassis_split_rate,stopoff_rate,fuel_mode,base_rate")
    .eq("terminal", booking.terminal).eq("customer_code", customer.code)
    .eq("revenue_code", booking.terminal === "HOU" ? "HLOCA" : "DDRAY").eq("service_type", "drayage").eq("active", true)
    .in("site_code", sites).in("return_location", [...destinations, ""]);
  if (error) throw Error("Could not load the customer billing rate.");
  return sites.flatMap(site => destinations.map(destination => data.find(row => row.site_code === site && row.return_location === destination)))
    .find(Boolean) ?? sites.map(site => data.find(row => row.site_code === site && row.return_location === "")).find(Boolean) ?? null;
}
