export const MAX_BOOKING_BYTES = 25 * 1024 * 1024;
export const DIRECT_BOOKING_BYTES = 3 * 1024 * 1024;
export const BOOKING_UPLOAD_BUCKET = "outbound-booking-uploads";
export function validateBookingFile(name: string, size: number) {
  if (!/\.(xlsx|xlsb|rtf)$/i.test(name)) throw Error("Choose an .xlsx, .xlsb, or .rtf booking request.");
  if (!Number.isSafeInteger(size) || size < 1) throw Error("The booking file is empty.");
  if (/\.rtf$/i.test(name) && size > DIRECT_BOOKING_BYTES) throw Error("Toyo RTF files can be up to 3 MB.");
  if (size > MAX_BOOKING_BYTES) throw Error("Booking files can be up to 25 MB.");
}
