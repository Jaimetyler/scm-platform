import { MAX_COTTON_PICKUPS } from "./stop-off.ts";
import { buildCottonOrderPreview } from "./preview.ts";
import type { CottonLocation } from "./location-resolution.ts";
import type { DispatchOrder } from "./bunge-dispatch.ts";
import type { PickupLine } from "../bunge/preview.ts";

export function regionalOrder(lines: PickupLine[], salesOrder: string, destination: string,
  revenue: "MAIN" | "DAVIS", locations: readonly CottonLocation[], customerId: "BUNGOMNE" | "OLAMRITX" = "BUNGOMNE") {
  const matches = lines.filter(line => line.so === salesOrder);
  const mark = matches[0]?.mark;
  if (!mark || matches.length > MAX_COTTON_PICKUPS || matches.some(line => line.mark !== mark || !line.rtl || !line.warehouseCode))
    throw Error("Selected order requires one mark, up to 20 pickups, and mapped warehouse codes and dates.");
  const distinct = new Set(matches.map(line => `${line.warehouseCode}|${line.rtl}`));
  if (distinct.size !== matches.length) throw Error("Repeated pickup location and date require review.");
  const bookings = [...new Set(matches.map(line => line.bookingNumber).filter(Boolean))];
  if (bookings.length > 1) throw Error("Selected order has conflicting booking numbers.");
  const bales = matches.reduce((sum, line) => sum + line.bales, 0);
  const source: DispatchOrder = {
    salesOrder, mark, bales, ...(bookings[0] ? { bookingNumber: bookings[0] } : {}),
    pickups: matches.map(line => ({
      row: line.row, mark, salesOrder, bales: line.bales, warehouse: line.warehouse,
      rtl: line.rtl!, usdaWarehouseCode: line.warehouseCode, weight: line.weight ?? undefined,
    })),
  };
  const proposal = buildCottonOrderPreview({
    customerId, revenueCode: revenue, mark, baleCount: bales, deliveryLocation: destination,
    pickups: matches.map(line => ({ locationCode: line.warehouseCode, scheduledDate: line.rtl! })),
  }, locations, customerId);
  return { source, proposal };
}
