import { createClient } from "@supabase/supabase-js";
import { lookupMcleodGateOrder } from "./mcleod-order-id";

type CarrierRow = { id: string; terminal: string; site_name: string; matched_order_id: string | null;
  trucking_company: string | null };

// Older check-ins did not store the carrier. Fill it once for linked orders so
// the warehouse sheets can show the company without repeated McLeod lookups.
export async function backfillTruckingCompanies<T extends CarrierRow>(rows: T[], persist = true): Promise<T[]> {
  const missing = rows.filter((row) => row.matched_order_id && !row.trucking_company).slice(0, 30);
  if (!missing.length) return rows;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return rows;
  const sb = createClient(url, key);
  const names = new Map<string, string>();
  await Promise.all(missing.map(async (row) => {
    try {
      if (row.terminal !== "SAV" && row.terminal !== "HOU") return;
      const order = await lookupMcleodGateOrder(row.matched_order_id!, row.terminal, row.site_name);
      if (!order.carrierName) return;
      if (!persist) { names.set(row.id, order.carrierName); return; }
      const { data, error } = await sb.from("inbound_checkin_rows")
        .update({ trucking_company: order.carrierName }).eq("id", row.id).is("trucking_company", null)
        .select("trucking_company").maybeSingle();
      if (!error && data?.trucking_company) names.set(row.id, data.trucking_company);
    } catch { /* Show the row even when an older order cannot be resolved. */ }
  }));
  return rows.map((row) => names.has(row.id) ? { ...row, trucking_company: names.get(row.id)! } : row);
}
