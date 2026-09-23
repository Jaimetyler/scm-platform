const PRIVATE_DRIVER_FIELDS = new Set([
  "driver_phone",
  "driver_latitude",
  "driver_longitude",
  "driver_accuracy_m",
  "driver_distance_m",
  "driver_checkin_site_id",
]);

// Normal grid responses may identify a QR arrival, driver, and carrier, but
// exact GPS evidence and phone numbers stay server-side for audit/privacy.
export function publicCheckinRow<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !PRIVATE_DRIVER_FIELDS.has(key))
  );
}
