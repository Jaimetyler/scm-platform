import { resolveCottonWarehouseName, resolveCottonLocation, type CottonLocation } from "./location-resolution.ts";
import type { DispatchOrder } from "./bunge-dispatch.ts";
import { buildCottonOrderPreview, type CottonOrderPreview } from "./preview.ts";

export type DispatchOrderReview = {
  salesOrder: string;
  status: "review_required" | "blocked";
  reason: string;
  preview?: CottonOrderPreview;
};
/** This stage never writes to McLeod or assumes a destination code for Dallas #2. */
export function previewBungeDispatchOrders(
  orders: readonly DispatchOrder[],
  destinationKind: "SAVANNAH" | "DALLAS_2" | "HOUSTON",
  locations: readonly CottonLocation[],
): DispatchOrderReview[] {
  return orders.map(order => {
    try {
      if (destinationKind === "DALLAS_2")
        throw new Error("Dallas #2 destination code must be explicitly verified before import.");
      const pickups = order.pickups.map(line => {
        const byName = resolveCottonWarehouseName(line.warehouse, locations);
        const location = line.usdaWarehouseCode
          ? resolveCottonLocation(line.usdaWarehouseCode, locations)
          : byName;
        if (location.id !== byName.id)
          throw new Error("USDA warehouse code conflicts with dispatch warehouse name.");
        const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(line.rtl);
        if (!match) throw new Error("Invalid pickup RTL date");
        const year = match[3].length === 2 ? "20" + match[3] : match[3];
        return { locationCode: location.mcleod_code,
          scheduledDate: `${year}-${match[1].padStart(2,"0")}-${match[2].padStart(2,"0")}` };
      });
      const preview = buildCottonOrderPreview({
        customerId: "BUNGOMNE", revenueCode: "MAIN", mark: order.mark,
        baleCount: order.bales, pickups,
        deliveryLocation: destinationKind === "HOUSTON" ? "SUPPBAT1" : "SAVAGAG2",
      }, locations);
      return { salesOrder: order.salesOrder, status: "review_required" as const,
        reason: "Pickup schedule, duplicate lookup and final delivery must be verified.", preview };
    } catch (error) {
      return { salesOrder: order.salesOrder, status: "blocked" as const,
        reason: error instanceof Error ? error.message : "Unknown dispatch error" };
    }
  });
}
