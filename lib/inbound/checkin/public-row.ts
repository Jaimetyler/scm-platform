const PRIVATE_DRIVER_FIELDS = new Set([
  "driver_phone",
  "driver_name",
  "trucking_company",
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
  return {
    has_bol_photo: Boolean(row.bol_photo_path),
    ...Object.fromEntries(
    Object.entries(row).filter(([key]) => !PRIVATE_DRIVER_FIELDS.has(key))
    ),
  };
}
