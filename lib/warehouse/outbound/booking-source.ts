import { createHmac, timingSafeEqual } from "node:crypto";
import { BOOKING_UPLOAD_BUCKET, DIRECT_BOOKING_BYTES, validateBookingFile } from "./upload-limits.ts";
export { BOOKING_UPLOAD_BUCKET };
type Receipt = { path: string; name: string; size: number; owner: string; terminal: string; expires: number };
export function signBookingUpload(value: Receipt, secret: string) {
  if (!secret) throw Error("Booking uploads are not configured.");
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
export function verifyBookingUpload(token: string, owner: string, terminal: string, secret: string, now = Date.now()): Receipt {
  if (!secret || !owner || token.length > 3000) throw Error("Upload authorization is unavailable. Upload the file again.");
  const [payload, signature, extra] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload ?? "").digest();
  if (extra || !/^[a-f0-9]{64}$/.test(signature ?? "") || !timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw Error("Invalid booking upload authorization.");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Receipt;
  if (value.owner !== owner || value.terminal !== terminal || !Number.isFinite(value.expires) || value.expires < now || value.expires > now + 2 * 60 * 60 * 1000 ||
    typeof value.path !== "string" || !value.path.startsWith(`${owner}/`) || !/^[a-f0-9-]+\/[a-f0-9-]+\.(xlsx|xlsb)$/i.test(value.path) || typeof value.name !== "string")
    throw Error("Booking upload expired or belongs to another user or terminal. Upload it again.");
  validateBookingFile(value.name, value.size);
  return value;
}
export async function readBookingSource(form: FormData, context: {
  owner: string; terminal: string; secret: string;
  download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
}, field = "file") {
  const file = form.get(field);
  if (file instanceof File) {
    validateBookingFile(file.name, file.size);
    if (file.size > DIRECT_BOOKING_BYTES) throw Error("Refresh this page and upload again to use the large-file uploader (up to 25 MB).");
    return { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
  }
  const receipt = verifyBookingUpload(String(form.get("uploadReceipt") ?? ""), context.owner, context.terminal, context.secret);
  const result = await context.download(receipt.path);
  if (result.error || !result.data) throw Error("Could not read the uploaded booking. Upload the file again.");
  if (result.data.size !== receipt.size) throw Error("Uploaded file size does not match. Upload the file again.");
  return { name: receipt.name, bytes: Buffer.from(await result.data.arrayBuffer()) };
}
