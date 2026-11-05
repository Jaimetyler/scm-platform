import type { CottonOrderPreview } from "./preview.ts";
import type { DispatchOrder } from "./bunge-dispatch.ts";

type PickupWindow = { early: string | null; late: string | null };

export function draftHoustonOrder(
  order: DispatchOrder,
  preview: CottonOrderPreview,
  windows: readonly PickupWindow[],
) {
  if (preview.customerId !== "BUNGOMNE" || preview.revenueCode !== "MAIN" ||
      preview.deliveryLocation !== "SUPPBAT1" || windows.length !== preview.pickupStops.length)
    throw new Error("Houston order draft requires the approved Bunge Baytown profile.");

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

  // Keep local times and the source SO explicit until their McLeod encoding is confirmed.
  return {
    salesOrder: order.salesOrder,
    baleCount: order.bales,
    order: {
      __type: "orders", company_id: "TMS", status: "A", customer_id: preview.customerId,
      revenue_code_id: preview.revenueCode, commodity_id: preview.commodity,
      blnum: preview.blnum, consignee_refno: order.mark.toUpperCase(),
      stops: [...pickups, {
        __type: "stop", __name: "stops", company_id: "TMS", stop_type: "SO",
        status: "A", order_sequence: pickups.length + 1, location_id: preview.deliveryLocation,
      }],
    },
  };
}
