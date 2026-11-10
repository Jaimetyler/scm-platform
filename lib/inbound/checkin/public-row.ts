const PRIVATE_DRIVER_FIELDS = new Set([
  "pickup_agreement",
  "driver_phone",
  "driver_name",
  "driver_latitude",
  "driver_longitude",
  "driver_accuracy_m",
  "driver_distance_m",
  "driver_checkin_site_id",
  "bol_photo_path",
  "bol_photo_original_name",
  "bol_photo_content_type",
  "bol_photo_uploaded_at",
]);

// Normal grid responses identify a QR arrival and whether it has a BOL image,
// but driver identity, contact information, documents, and exact GPS evidence
// stay behind the authenticated warehouse details page.
export function publicCheckinRow<T extends Record<string, unknown>>(row: T) {
  const arrival = Array.isArray(row.arrival_number) ? row.arrival_number[0] : row.arrival_number;
  const number = arrival as { queue_day?: string; queue_number?: number; freight_number?: number } | undefined;
  return {
    ...(arrival !== undefined ? { queue_day: number?.queue_day ?? null, queue_number: number?.queue_number ?? null, freight_number: number?.freight_number ?? null } : {}),
    has_pickup_agreement: Boolean(row.pickup_agreement),
    has_bol_photo: Boolean(row.bol_photo_path),
    ...Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "arrival_number" && !PRIVATE_DRIVER_FIELDS.has(key))
    ),
  };
}
