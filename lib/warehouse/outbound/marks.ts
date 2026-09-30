export function bookingMarkBadges(line: {
  available_bales: number; warehouse_bales?: number; inbound_bales: number; inbound_statuses?: string[];
}) {
  const badges: { label: string; color: string; background: string; title: string }[] = [];
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
