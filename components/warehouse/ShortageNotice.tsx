"use client";

import { useState } from "react";
import { cottonShortage, shortageAcknowledged, type ShortageFields } from "@/lib/inbound/checkin/shortage";

export type ShortageAction = { acknowledgeShortage?: boolean; shortageNote?: string; customerNotified?: boolean; notificationNote?: string };

export default function ShortageNotice({ row, disabled, complete, onAction }: {
  row: ShortageFields; disabled?: boolean; complete?: boolean;
  onAction?: (action: ShortageAction) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shortage = cottonShortage(row);
  if (!shortage) return null;
  const acknowledged = shortageAcknowledged(row);
  async function save() {
    if (!onAction || !note.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await onAction(acknowledged ? { customerNotified: true, notificationNote: note } : { acknowledgeShortage: true, shortageNote: note });
      setNote("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save shortage follow-up"); }
    finally { setBusy(false); }
  }
  return <div role="alert" style={{ border: "1px solid #d97706", background: "rgba(180,83,9,.12)", padding: 14, borderRadius: 8, color: "#fde68a", margin: "8px 0", width: "100%", boxSizing: "border-box" }}>
    <strong>{shortage.missing} bale{shortage.missing === 1 ? "" : "s"} short · Expected {shortage.expected} · {row.bale_count != null ? "Unloaded" : "Driver / BOL reported"} {shortage.received}</strong>
    <p style={{ margin: "7px 0" }}>McLeod delivery cannot be posted while the bale count is short. {acknowledged ? "Shortage acknowledged; receiving can finish." : "Acknowledge the shortage before finishing receiving."}</p>
    {acknowledged && <p style={{ margin: "7px 0", whiteSpace: "pre-wrap" }}>Acknowledged by {row.shortage_acknowledged_by || "staff"}: {row.shortage_note}</p>}
    <p style={{ margin: "7px 0" }}>{row.customer_notified_at ? `Customer notified by ${row.customer_notified_by || "staff"}.` : "Customer notification needed. Contact the customer and record follow-up in Notes."}</p>
    {onAction && !row.customer_notified_at && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label style={{ display: "grid", gap: 5, flex: "1 1 260px" }}>{acknowledged ? "Customer notification note" : "Shortage note"}
        <textarea aria-label={acknowledged ? "Customer notification note" : "Shortage note"} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled || busy}
          style={{ padding: 8, border: "1px solid #64748b", background: "#0f172a", color: "white", borderRadius: 5 }} />
      </label>
      <button type="button" disabled={disabled || busy || !note.trim()} onClick={() => void save()}
        style={{ padding: "9px 12px", border: "1px solid #d97706", background: "#92400e", color: "white", borderRadius: 6, cursor: "pointer" }}>
        {busy ? "Saving…" : acknowledged ? "Record customer notified" : complete ? "Acknowledge & finish check-in" : "Acknowledge shortage"}
      </button>
    </div>}
    {error && <p style={{ color: "#fca5a5" }}>{error}</p>}
  </div>;
}
