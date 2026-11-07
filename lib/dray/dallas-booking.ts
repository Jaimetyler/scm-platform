import { bookingReturnLocation } from "../warehouse/outbound/return-location.ts";
import { parseBookingRequest, type BookingImportOptions } from "../warehouse/outbound/booking-import.ts";

const pickupLocations: Readonly<Record<string, string>> = {
  "875260": "SCMDDETX",
  "843001": "SCMDDATX",
};

export function previewDallasBungeDrays(bytes: Buffer, options: BookingImportOptions = {}) {
  const booking = parseBookingRequest(bytes, options);

  const deliveryLocation = bookingReturnLocation(booking.returnLocation || booking.loadPort).return_location_code;
  const issues = [...booking.warnings, ...booking.detailNotes];
  if (!deliveryLocation) issues.push(`Unmapped load port: ${booking.loadPort || "missing"}.`);
  if (booking.containers !== booking.lines.length) {
    issues.push("Container count and mark row count differ. Confirm how the marks are assigned to drays.");
  }
  const references = new Set<string>();
  const lines = booking.lines.map(line => {
    const pickupLocation = pickupLocations[line.warehouseCode] ?? null;
    const rowIssues: string[] = [];
    if (!pickupLocation) rowIssues.push("Pickup warehouse code needs a Dallas mapping.");
    if (!line.shippingOrder) rowIssues.push("Shipping order is missing.");
    else if (references.has(line.shippingOrder)) rowIssues.push("Repeated shipping order; review container grouping.");
    references.add(line.shippingOrder);
    return { ...line, pickupLocation, issues: rowIssues };
  });
  return {
    customerId: booking.sourceFormat === "bunge" ? "BUNGOMNE" : booking.sourceFormat === "olam" ? "OLAMRITX" : null, customer: booking.customer, bookingNumber: booking.bookingNumber, customerReference: booking.customerReference,
    loadPort: booking.loadPort, steamshipLine: booking.steamshipLine, deliveryLocation,
    vessel: booking.vessel, erd: booking.erd, sourceDates: booking.sourceDates,
    containers: booking.containers, totalBales: booking.totalBales, issues, lines,
  };
}
