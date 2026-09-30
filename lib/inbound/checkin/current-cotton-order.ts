function day(value: unknown) {
  const raw = String(value ?? "").trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parts = compact ?? iso;
  if (!parts) return null;
  const timestamp = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(parts[1]) && date.getUTCMonth() + 1 === Number(parts[2]) && date.getUTCDate() === Number(parts[3]) ? timestamp : null;
}

// Matches for a live arrival must be recent, undelivered cotton deliveries.
// Missing evidence means staff review, never an automatic outside-carrier receipt.
export function currentCottonOrder(order: Record<string, any>, arrival: unknown = new Date().toISOString()) {
  const stops = Array.isArray(order.stops) ? order.stops : [];
  const delivery = stops.find((stop: Record<string, any>) => stop.stop_type === "SO");
  if (!delivery) return { eligible: false, historical: false, reason: "McLeod order has no delivery stop; review the order" };
  const status = String(order.__statusDescr ?? order.status ?? "").trim();
  if (String(delivery.actual_departure ?? "").trim() || /delivered|completed|cancelled|canceled/i.test(status))
    return { eligible: false, historical: true, reason: "McLeod order is already delivered or closed" };
  const scheduled = day(delivery.sched_arrive_early || delivery.sched_arrive_late || order.ordered_date);
  const received = day(arrival);
  if (scheduled === null || received === null) return { eligible: false, historical: false, reason: "McLeod delivery date is missing or invalid; review the order" };
  if (scheduled < received - 45 * 86400000 || scheduled > received + 45 * 86400000)
    return { eligible: false, historical: true, reason: "McLeod delivery is outside the current 45-day matching window" };
  return { eligible: true, historical: false, reason: "Current undelivered order" };
}
