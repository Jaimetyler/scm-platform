import { PROFILES, type Profile } from "../ecotton/model.ts";
import { PROFILE, requiresDrayShippingOrder, type DrayInvoice } from "./model.ts";
import { bookingChargeCustomer } from "./booking-customers.ts";
import { carrierPlanLines, type CarrierPlan, type CustomerBillRates } from "../warehouse/outbound/carrier-rates.ts";

export const houstonDrayChargeCodes = { chassisDays: "019", chassisSplits: "HSPT", stopoffs: "006", fuel: "HFS" } as const;
export const houstonBookingLocation = "SUPPBAT1";
export type HoustonImportBooking = {
  id: string; terminal: string; site_code: string; status: string; booking_number: string;
  customer: string; scm_file_number: string | null; steamship_line: string | null;
};
export type HoustonImportSlot = {
  id: string; sequence_no: number; booking_line_id: string | null; split_transfer_id: string | null;
  container_number: string | null; chassis_number: string | null; seal_number: string | null;
  carrier_plan: CarrierPlan | null;
};
export type HoustonImportMark = { id: string; mark: string; shipping_order: string | null; line_status: string; load_source: string; requested_bales: number };

export function houstonBookingInvoice(booking: HoustonImportBooking, slot: HoustonImportSlot,
  mark: HoustonImportMark | undefined, billing: CustomerBillRates | null, date: string) {
  if (booking.terminal !== "HOU" || booking.site_code !== "5300" || booking.status !== "draft")
    throw Error("Choose an active Houston 5300 booking.");
  if (slot.split_transfer_id || !mark || mark.id !== slot.booking_line_id || mark.line_status !== "active" || mark.load_source !== "warehouse")
    throw Error("Choose an active warehouse mark on this booking.");
  if (!Number.isSafeInteger(mark.requested_bales) || mark.requested_bales <= 0)
    throw Error("Save the mark’s bale count.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw Error("Enter a valid order date.");
  const customer = bookingChargeCustomer(booking.customer, "HOU");
  if (!customer) throw Error("The Houston customer account is not configured.");
  const container = String(slot.container_number ?? "").trim().toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(container)) throw Error("Save a full container number.");
  const shippingOrder = mark.shipping_order?.trim() ?? "";
  if (!shippingOrder && requiresDrayShippingOrder(customer.code, booking.terminal)) throw Error("Save the mark’s shipping order.");
  if (!booking.scm_file_number?.trim()) throw Error("Save the SCM file number in booking details.");
  if (!booking.steamship_line?.trim() || !booking.booking_number.trim()) throw Error("Save the SSL and booking number.");
  for (const [label, value, limit] of [
    ["Mark", mark.mark, 28], ["Shipping order", shippingOrder, 40],
    ["Booking number", booking.booking_number, 40], ["SCM file number", booking.scm_file_number, 80],
  ] as const) if (value.trim().length > limit) throw Error(`${label} exceeds the McLeod field limit.`);
  const plan = slot.carrier_plan;
  if (!plan || !/^[A-Z0-9_-]{1,30}$/.test(plan.rate.carrier_id.trim().toUpperCase()))
    throw Error("Assign a carrier with a saved rate.");
  if (!billing || billing.base === null) throw Error("An all-in Houston customer rate for HOUPORT is required.");
  const amounts = carrierPlanLines(plan, billing);
  if (amounts.some(line => line.billTotal === null)) throw Error("Complete the customer rates for the selected charges.");
  const carrierCents = amounts.reduce((sum, line) => sum + line.payTotal, 0);
  if (!Number.isSafeInteger(carrierCents) || carrierCents <= 0) throw Error("Save a positive carrier pay rate.");
  const codes = { base: "", ...houstonDrayChargeCodes };
  const charges = amounts.filter(line => line.key !== "base" && line.billTotal! > 0).map(line => ({
    code: codes[line.key], description: line.key === "chassisDays" ? "HOU Chassis Charges" : line.label,
    units: line.billUnits, cents: line.billTotal!,
  }));
  const baseCents = billing.base;
  const cents = baseCents + charges.reduce((sum, line) => sum + line.cents, 0);
  if (![baseCents, cents].every(value => Number.isSafeInteger(value) && value >= 0)) throw Error("Customer billing totals are invalid.");
  const profile: Profile = {
    ...PROFILE, id: "HOU-5300-BOOKING", terminal: "HOU", label: "Houston 5300 → HOUPORT",
    location: houstonBookingLocation, revenue: PROFILES.find(profile => profile.terminal === "HOU")!.revenue,
    payee: plan.rate.carrier_id.trim().toUpperCase(), timezone: "America/Chicago",
  };
  const invoice: DrayInvoice & { bookingId: string; bookingContainerId: string; bales: number } = {
    reference: mark.mark.trim(), mark: container, invoiceDate: date, shipperId: "",
    customerName: booking.customer, customerId: customer.code, cents, charges,
    sourceKey: `BOOKING:${booking.id}:${slot.id}`, shippingOrder,
    customerOrder: shippingOrder, container, chassis: slot.chassis_number ?? "",
    seal: slot.seal_number ?? "", fileNumber: booking.scm_file_number.trim(), booking: booking.booking_number.trim(),
    steamship: booking.steamship_line.trim(), destination: "HOUPORT", baseCents, carrierCents,
    firstStarLoad: null, inputErrors: [], bookingId: booking.id, bookingContainerId: slot.id, bales: mark.requested_bales,
  };
  return { invoice, profile };
}
