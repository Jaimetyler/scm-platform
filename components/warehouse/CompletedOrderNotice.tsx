import type { McleodCompletion } from "@/lib/inbound/checkin/mcleod-order-id";
import { translateDriverText, type DriverLanguage } from "@/lib/inbound/checkin/driver-language";

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

export default function CompletedOrderNotice({ orderId, completion, language = "en" }: {
  orderId: string; completion: McleodCompletion; language?: DriverLanguage;
}) {
  const t = (text: string) => translateDriverText(text, language);
  return <div role="status" style={{ border: "1px solid #a16207", borderRadius: 8,
    background: "#302617", color: "#fef3c7", padding: "10px 12px", marginTop: 8, fontSize: 13 }}>
    <strong>{t(completion.message)}</strong>
    <div>{language === "es" ? "Orden SCM" : "SCM order"} #{orderId}{completion.location ? ` · ${completion.location}` : ""}</div>
    <div>{language === "es" ? "Empresa de transporte:" : "Trucking company:"} {completion.carrierName || (completion.carrierCode
      ? `${language === "es" ? "Nombre no disponible (código de transportista:" : "Name unavailable (carrier code:"} ${completion.carrierCode})` : t("Trucking company unavailable"))}</div>
    <div>{completion.kind === "cancelled" ? t("Cancellation time unavailable") : completionTime(completion.completedAt)
      .replace("McLeod local time", language === "es" ? "hora local de McLeod" : "McLeod local time")
      .replace("Completion time unavailable", t("Completion time unavailable"))}</div>
    <div style={{ marginTop: 4 }}>{t("This order cannot be checked in again. Contact warehouse staff if the record needs correction.")}</div>
  </div>;
}
