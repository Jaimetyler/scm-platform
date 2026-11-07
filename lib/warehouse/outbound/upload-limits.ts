export const MAX_BOOKING_BYTES = 25 * 1024 * 1024;
export const DIRECT_BOOKING_BYTES = 3 * 1024 * 1024;
export const BOOKING_UPLOAD_BUCKET = "outbound-booking-uploads";
export function validateBookingFile(name: string, size: number) {
  if (!/\.(xlsx|xlsb)$/i.test(name)) throw Error("Choose an .xlsx or .xlsb booking request.");
  if (!Number.isSafeInteger(size) || size < 1) throw Error("The booking file is empty.");
  if (size > MAX_BOOKING_BYTES) throw Error("Booking files can be up to 25 MB.");
}
