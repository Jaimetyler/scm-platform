import type { McleodOrderSummary, McleodStop } from "./types";
import { asArray } from "@/lib/late-fees/utils";

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getOrderId(order: McleodOrderSummary): string {
  return String(order.order_id ?? order.id ?? "").trim();
}

export function getMovementStatus(order: McleodOrderSummary): string {
  const direct = safeString(order.movement?.status).toUpperCase();
  if (direct) return direct;

  const arr = asArray<{
  status?: string | null;
  brokerage_status?: string | null;
}>(order.movements);
  const first = arr[0];

  return safeString(first?.status).toUpperCase();
}

export function getBrokerageStatus(order: McleodOrderSummary): string {
  const direct = safeString(order.movement?.brokerage_status).toUpperCase();
  if (direct) return direct;

  const arr = asArray<{
  status?: string | null;
  brokerage_status?: string | null;
}>(order.movements);
  const first = arr[0];

  return safeString(first?.brokerage_status).toUpperCase();
}

export function getStop(
  order: McleodOrderSummary,
  stopType: "PU" | "SO"
): McleodStop | null {
  const stops = asArray<McleodStop>(order.stops);

  return (
    stops.find((s) => safeString(s.stop_type).toUpperCase() === stopType) ??
    null
  );
}