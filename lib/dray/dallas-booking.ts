import { bookingReturnLocation } from "../warehouse/outbound/return-location.ts";
import { parseBookingRequest, type BookingImportOptions } from "../warehouse/outbound/booking-import.ts";

import { outboundDrayMarkets } from "./outbound-load-plan.ts";

export function previewDallasBungeDrays(bytes: Buffer, options: BookingImportOptions = {}) {
  const booking = parseBookingRequest(bytes, options);

  const deliveryLocation = bookingReturnLocation(booking.returnLocation || booking.loadPort).return_location_code;
  const issues = [...booking.warnings, ...booking.detailNotes];
  if (!deliveryLocation) issues.push(`Unmapped load port: ${booking.loadPort || "missing"}.`);
  const lines = booking.lines.map(line => {
    const pickupLocation = outboundDrayMarkets.DAL.pickupLocations[line.warehouseCode] ?? null;
    return { ...line, pickupLocation, issues: pickupLocation ? [] : ["Pickup warehouse code needs a Dallas mapping."] };
  });
  const pickups = [...new Set(lines.map(line => line.pickupLocation))];
  const pickupLocation = pickups.length === 1 ? pickups[0] : null;
  if (!pickupLocation) issues.push("Resolve a single pickup warehouse for this booking.");
  return {
    customerId: booking.sourceFormat === "bunge" ? "BUNGOMNE" : booking.sourceFormat === "olam" ? "OLAMRITX" : null, customer: booking.customer, bookingNumber: booking.bookingNumber, customerReference: booking.customerReference,
    loadPort: booking.loadPort, steamshipLine: booking.steamshipLine, deliveryLocation, pickupLocation,
    vessel: booking.vessel, erd: booking.erd, sourceDates: booking.sourceDates,
    containers: booking.containers, totalBales: booking.totalBales, issues, lines,
  };
}
