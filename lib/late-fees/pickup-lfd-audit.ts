import { staffDatabase } from "@/lib/auth/session";

export async function readPickupLfdAudit(orderIds: readonly string[]) {
  const ids = [...new Set(orderIds.filter(id => /^[A-Za-z0-9_-]{1,32}$/.test(id)))];
  const dates = new Map<string, Set<string>>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await staffDatabase().from("cotton_bunge_import_orders")
      .select("mcleod_order_id,last_free_date:reviewed_payload->>lastFreeDate")
      .in("mcleod_order_id", ids.slice(offset, offset + 100));
    if (error) throw new Error("Could not read the pickup last-free-day audit.");
    for (const row of data ?? []) {
      if (!row.mcleod_order_id || !row.last_free_date) continue;
      const orderDates = dates.get(row.mcleod_order_id) ?? new Set<string>();
      orderDates.add(row.last_free_date);
      dates.set(row.mcleod_order_id, orderDates);
    }
  }
  return dates;
}
