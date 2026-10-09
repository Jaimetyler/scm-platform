import { enrichDisplayCarriers } from "./display-carrier";
// Compatibility wrapper: GET enrichment is display-only and never writes rows.
export async function backfillTruckingCompanies<T extends { matched_order_id?: string | null; trucking_company?: string | null }>(rows: T[], _persist = false): Promise<T[]> {
  return enrichDisplayCarriers(rows);
}
