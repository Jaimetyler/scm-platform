import { bookingReturnLocation } from "../warehouse/outbound/return-location.ts";
import { parseBookingRequest, type BookingImportOptions } from "../warehouse/outbound/booking-import.ts";

import { outboundDrayMarkets } from "./outbound-load-plan.ts";

export function previewDallasBungeDrays(bytes: Buffer, options: BookingImportOptions = {}) {
  const booking = parseBookingRequest(bytes, options);

  const deliveryLocation = bookingReturnLocation(booking.returnLocation || booking.loadPort).return_location_code;
  const rail = deliveryLocation === "BNSFHATX" || deliveryLocation === "UNIOWITX";
  const rampCut = rail ? booking.sourceDates.find(date => date.label === "Ramp Cut")?.value : undefined;
  const cutoff = rampCut ?? (rail && booking.sourceDates.some(date => date.label === "Port Cut" && date.value === booking.cutoff)
    ? null : booking.cutoff);
  const inferredDocCutoff = booking.detailNotes.some(note => note.startsWith("Doc cutoff uses the earlier source date"));
  const docCutoff = rail && inferredDocCutoff && booking.sourceDates.some(date =>
    ["Ramp Cut", "Port Cut"].includes(date.label) && date.value === booking.docCutoff) ? null : booking.docCutoff;
  const detailNotes = rail ? booking.detailNotes.filter(note =>
    !note.startsWith("Doc cutoff uses the earlier source date") &&
    !note.startsWith("The request has more than two distinct cutoff dates")) : booking.detailNotes;
  const issues = [...booking.warnings, ...detailNotes];
  if (rail && !cutoff) issues.push("Enter the rail ramp cutoff. Port Cut is the destination port deadline.");
  if (!deliveryLocation) issues.push(`Unmapped load port: ${booking.loadPort || "missing"}.`);
  const lines = booking.lines.map(line => {
    const pickupLocation = outboundDrayMarkets.DAL.pickupLocations[line.warehouseCode] ?? null;
    return { ...line, pickupLocation, issues: pickupLocation ? [] : ["Pickup warehouse code needs a Dallas mapping."] };
  });
  const pickups = [...new Set(lines.map(line => line.pickupLocation))];
  const pickupLocation = pickups.length === 1 ? pickups[0] : null;
  if (!pickupLocation) issues.push("Resolve a single pickup warehouse for this booking.");
  return {
    sourceFormat: booking.sourceFormat,
    customerId: booking.sourceFormat === "bunge" ? "BUNGOMNE" : booking.sourceFormat === "olam" ? "OLAMRITX" : null, customer: booking.customer, bookingNumber: booking.bookingNumber, bookId: booking.bookId ?? "", customerReference: booking.customerReference,
    loadPort: booking.loadPort, steamshipLine: booking.steamshipLine, deliveryLocation, pickupLocation,
    vessel: booking.vessel, erd: booking.erd, docCutoff, cutoff, sourceDates: booking.sourceDates,
    containers: booking.containers, totalBales: booking.totalBales, issues, lines,
  };
}
