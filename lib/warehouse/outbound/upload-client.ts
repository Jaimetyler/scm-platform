import { DIRECT_BOOKING_BYTES, validateBookingFile } from "./upload-limits";
const uploads = new WeakMap<File, { terminal: string; receipt: string; expires: number }>();
export async function attachBookingFile(form: FormData, file: File, terminal: string, signal?: AbortSignal, field = "file") {
  validateBookingFile(file.name, file.size);
  form.delete(field);
  if (file.size <= DIRECT_BOOKING_BYTES) { form.set(field, file); return; }
  const cached = uploads.get(file);
  if (cached && cached.terminal === terminal && cached.expires > Date.now()) {
    form.set("uploadReceipt", cached.receipt); return;
  }
  const response = await fetch("/api/warehouse/outbound/uploads", { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminal, filename: file.name, size: file.size }) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw Error(result.error || "Could not start booking upload.");
  // The file goes directly to private storage, bypassing the hosting request-size cap.
  const uploaded = await fetch(result.signedUrl, { method: "PUT", signal, body: file,
    headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" } });
  if (!uploaded.ok) throw Error(`Booking upload failed (${uploaded.status}). Try again.`);
  uploads.set(file, { terminal, receipt: result.receipt, expires: Date.now() + 60 * 60 * 1000 });
  form.set("uploadReceipt", result.receipt);
}
