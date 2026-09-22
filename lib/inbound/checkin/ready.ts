export type CheckinReadyFields = {
  terminal?: string | null;
  site_code?: string | null;
  site_name?: string | null;
  sub_location?: string | null;
  received_date?: string | null;
  mark?: string | null;
  shipper?: string | null;
  bol_bc?: number | null;
  bale_count?: number | null;
  warehouse_location?: string | null;
  equipment_type?: string | null;
};

export function isReadyCheckin(row: CheckinReadyFields): boolean {
  return Boolean(
    row.terminal?.trim() && row.site_code?.trim() && row.site_name?.trim() &&
    row.sub_location?.trim() && row.received_date?.trim() &&
    row.mark?.trim() && row.shipper?.trim() &&
    Number(row.bol_bc ?? 0) > 0 && Number(row.bale_count ?? 0) > 0 &&
    row.warehouse_location?.trim() && row.equipment_type?.trim()
  );
}
