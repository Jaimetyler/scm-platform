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
  movement_direction?: string | null;
  material_type?: string | null;
};

export function usesMcleodCheckin(row: CheckinReadyFields): boolean {
  // Existing staff-created rows predate these fields and retain the original
  // cotton-delivery behavior.
  return (row.movement_direction ?? "delivery") === "delivery" &&
    (row.material_type ?? "cotton") === "cotton";
}

export function isReadyCheckin(row: CheckinReadyFields): boolean {
  if (!usesMcleodCheckin(row)) return false;
  return Boolean(
    row.terminal?.trim() && row.site_code?.trim() && row.site_name?.trim() &&
    row.sub_location?.trim() && row.received_date?.trim() &&
    row.mark?.trim() && row.shipper?.trim() &&
    Number(row.bol_bc ?? 0) > 0 && Number(row.bale_count ?? 0) > 0 &&
    row.warehouse_location?.trim() && row.equipment_type?.trim()
  );
}

type CorrectableRow = {
  terminal: string;
  site_code: string;
  site_name: string;
  sub_location: string;
  received_date: string | null;
  mark: string | null;
  shipper: string | null;
  bol_bc: number | null;
  bale_count: number | null;
  warehouse_location: string | null;
  equipment_type: string | null;
  comment_1: string | null;
  comment_2: string | null;
  identity_corrected_at?: string | null;
};

export function buildPostDeliveryCorrection(existing: CorrectableRow, edited: CorrectableRow, at: string) {
  if (!isReadyCheckin({ ...edited, terminal: existing.terminal,
    site_code: existing.site_code, site_name: existing.site_name })) {
    throw new Error("Complete all required fields before saving the correction");
  }

  const identityChanged = existing.mark !== edited.mark ||
    existing.shipper !== edited.shipper || existing.bol_bc !== edited.bol_bc;

  // Keep the original site, timestamps, McLeod order, and processed status.
  return {
    sub_location: edited.sub_location,
    received_date: edited.received_date,
    mark: edited.mark,
    shipper: edited.shipper,
    bol_bc: edited.bol_bc,
    bale_count: edited.bale_count,
    warehouse_location: edited.warehouse_location,
    equipment_type: edited.equipment_type,
    comment_1: edited.comment_1,
    comment_2: edited.comment_2,
    identity_corrected_at: identityChanged ? at : existing.identity_corrected_at ?? null,
  };
}
