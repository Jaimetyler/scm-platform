import type { McleodCompletion } from "@/lib/inbound/checkin/mcleod-order-id";

function completionTime(raw: string) {
  // McLeod compact timestamps carry the stop's local offset. Preserve it rather
  // than displaying the browser's timezone or inventing a time for a status.
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})?$/);
  if (compact) {
    const hour = Number(compact[4]);
    return `${compact[2]}/${compact[3]}/${compact[1]} ${hour % 12 || 12}:${compact[5]} ${hour >= 12 ? "PM" : "AM"}${compact[7] ? ` (UTC${compact[7].slice(0, 3)}:${compact[7].slice(3)})` : " (McLeod local time)"}`;
  }
  return raw || "Completion time unavailable";
}

export default function CompletedOrderNotice({ orderId, completion }: {
  orderId: string; completion: McleodCompletion;
}) {
  return <div role="status" style={{ border: "1px solid #a16207", borderRadius: 8,
    background: "#302617", color: "#fef3c7", padding: "10px 12px", marginTop: 8, fontSize: 13 }}>
    <strong>{completion.message}</strong>
    <div>SCM order #{orderId}{completion.location ? ` · ${completion.location}` : ""}</div>
    <div>Trucking company: {completion.carrierName || (completion.carrierCode
      ? `Name unavailable (carrier code: ${completion.carrierCode})` : "Trucking company unavailable")}</div>
    <div>{completion.kind === "cancelled" ? "Cancellation time unavailable" : completionTime(completion.completedAt)}</div>
    <div style={{ marginTop: 4 }}>This order cannot be checked in again. Contact warehouse staff if the record needs correction.</div>
  </div>;
}
