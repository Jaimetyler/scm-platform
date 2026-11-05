import { defaultDeliveryDate, SCM_DELIVERY_LOCATIONS, scmReceivingHours } from "../bunge/destinations.ts";
import type { CottonOrderPreview } from "./preview.ts";
import type { McLeodCottonEquipmentCode } from "./equipment.ts";
import type { DispatchOrder } from "./bunge-dispatch.ts";

type PickupWindow = { early: string | null; late: string | null };

export function draftHoustonOrder(
  order: DispatchOrder,
  preview: CottonOrderPreview,
  windows: readonly PickupWindow[],
  equipmentCode: McLeodCottonEquipmentCode,
) {
  const destination = SCM_DELIVERY_LOCATIONS.find(location => location.code === preview.deliveryLocation);
  if (preview.customerId !== "BUNGOMNE" || !destination ||
      preview.revenueCode !== (destination.terminal === "dallas" ? "DAVIS" : "MAIN") ||
      windows.length !== preview.pickupStops.length)
    throw new Error("The order draft requires the matching Bunge terminal profile.");

  const pickups = preview.pickupStops.map((pickup, index) => {
    const { early, late } = windows[index];
    if (!early || !late) throw new Error("Pickup window is incomplete.");
    return {
      __type: "stop", __name: "stops", company_id: "TMS", stop_type: "PU",
      status: "A", order_sequence: index + 1, location_id: pickup.locationCode,
      sched_arrive_early: `${pickup.scheduledDate}T${early}:00`,
      sched_arrive_late: `${pickup.scheduledDate}T${late}:00`,
      timezone: pickup.timezone,
    };
  });

  if (order.pickups.length !== pickups.length ||
      order.pickups.some(line => !Number.isSafeInteger(line.bales) || line.bales <= 0) ||
      order.pickups.reduce((total, line) => total + line.bales, 0) !== order.bales)
    throw new Error("Pickup bale counts do not reconcile with the order total.");

  // Draft references retain pickup sequence until the McLeod reference write contract is verified.
  const pickupReferences = pickups.length === 2 ? order.pickups.map((line, index) => ({
    stopSequence: pickups[index].order_sequence,
    locationCode: pickups[index].location_id,
    qualifier: "PU",
    referenceNumber: `${order.mark.toUpperCase()} ${line.bales} BALES`,
  })) : [];

  const weight = order.pickups.every(line => line.weight != null)
    ? order.pickups.reduce((total, line) => total + Math.round(line.weight! * 10), 0) / 10 : null;
  if (weight !== null && (order.pickups.some(line => !Number.isFinite(line.weight) || line.weight! <= 0) || !Number.isFinite(weight) || weight <= 0 || weight > 999999.9))
    throw Error("Order weight exceeds the McLeod weight field.");
  const deliveryDate = defaultDeliveryDate(preview.pickupStops.map(stop => stop.scheduledDate));
  if (!deliveryDate) throw new Error("Delivery date cannot be derived from the pickup dates.");
  const receiving = scmReceivingHours(preview.deliveryLocation);

  // Keep local times explicit until their McLeod encoding is confirmed.
  return {
    salesOrder: order.salesOrder,
    baleCount: order.bales,
    pickupReferences,
    deliveryDate,
    order: {
      __type: "orders", company_id: "TMS", status: "A", customer_id: preview.customerId,
      revenue_code_id: preview.revenueCode, commodity_id: preview.commodity,
      order_type_id: "FSC", order_mode: "T", ordered_by: order.salesOrder,
      equipment_type_id: equipmentCode,
      ...(weight === null ? {} : { weight }),
      ...(pickups.length === 2 ? { otherCharges: [{
        __type: "other_charge", __name: "otherCharges", company_id: "TMS",
        charge_id: "006", descr: "Stop Off Charge", units: 1, rate: 50, amount: 50,
        incl_in_freight: "N", bill_type: "F", calc_method: "F",
      }] } : {}),
      blnum: preview.blnum, consignee_refno: order.mark.toUpperCase(),
      stops: [...pickups, {
        __type: "stop", __name: "stops", company_id: "TMS", stop_type: "SO",
        status: "A", order_sequence: pickups.length + 1, location_id: preview.deliveryLocation,
        sched_arrive_early: `${deliveryDate}T${receiving.open}:00`,
        sched_arrive_late: `${deliveryDate}T${receiving.close}:00`,
        timezone: receiving.timezone,
      }],
    },
  };
}
