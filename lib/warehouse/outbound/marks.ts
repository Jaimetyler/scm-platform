export function bookingMarkBadges(line: {
  available_bales: number; warehouse_bales?: number; inbound_bales: number; inbound_statuses?: string[]; line_status?: string; load_source?: string; source_arrivals?: unknown[];
}) {
  const badges: { label: string; color: string; background: string; title: string }[] = [];
  if (line.line_status === "cancelled") return [{ label: "Cancelled", color: "#94a3b8", background: "rgba(71,85,105,.16)", title: "Removed from this booking’s active plan; history retained." }];
  if (line.line_status === "on_hold") badges.push({ label: "On hold", color: "#94a3b8", background: "rgba(180,83,9,.12)", title: "Waiting for new information. Resume before editing equipment or splitting." });
  if (line.load_source === "source_load") {
    badges.push({ label: "Source load", color: "#94a3b8", background: "rgba(71,85,105,.12)", title: "Direct pickup in a container at the source location; warehouse receipt is not expected." });
    if (line.source_arrivals?.length) badges.push({ label: "Unexpected warehouse arrival", color: "#fde68a", background: "rgba(180,83,9,.12)", title: "This source mark checked in at a warehouse. Review and convert its plan if needed." });
    return badges;
  }
  if ((line.warehouse_bales ?? line.available_bales) > 0) badges.push({ label: "In warehouse", color: "#86efac",
    background: "rgba(22,163,74,.16)", title: "Receiving completed; this mark has inventory at this warehouse." });
  if (line.inbound_bales > 0 || (line.inbound_statuses?.length ?? 0) > 0) badges.push({ label: "Checked in", color: "#7dd3fc",
    background: "rgba(2,132,199,.18)", title: "A load is checked in; its receiving has not been completed." });
  if (!badges.length) badges.push({ label: "Not received", color: "#fca5a5", background: "rgba(185,28,28,.14)",
    title: "No warehouse inventory or active check-in found for this mark." });
  return badges;
}

export function normalizeBookingMark(body: Record<string, unknown>) {
  const mark = String(body.mark ?? "").trim().toUpperCase();
  const bales = Number(body.bales);
  const shippingOrder = String(body.shippingOrder ?? "").trim();
  if (!mark || mark.length > 80 || !/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(mark)) throw new Error("Enter a mark using letters, numbers, spaces, periods, slashes, underscores, or hyphens (up to 80 characters).");
  if (!Number.isSafeInteger(bales) || bales < 1 || bales > 1000000) throw new Error("Enter a whole bale count between 1 and 1,000,000.");
  if (shippingOrder.length > 200) throw new Error("Shipping order must be 200 characters or fewer.");
  return { mark, bales, shippingOrder: shippingOrder || null };
}
