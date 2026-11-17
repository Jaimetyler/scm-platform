"use client";
import { useState } from "react";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";

type Row = {
  id: string; sequence: number; mark: string; container: string | null; bill?: number; pay?: number;
  carrier?: string; state: string; orderId: string | null; issue: string; token: string | null;
  ready: boolean; canReconcile: boolean;
};
export default function HoustonBookingImport({ bookingId, erd, disabled, onCreated }: {
  bookingId: string; erd: string | null; disabled: boolean; onCreated: () => Promise<void>;
}) {
  const [date, setDate] = useState(erd?.slice(0, 10) || warehouseDate(new Date(), "HOU"));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/warehouse/outbound/bookings/${bookingId}/houston-import`;
  async function request(body: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Houston import failed.");
    return result;
  }
  async function preview() {
    setBusy(true); setError("");
    try { setRows((await request({ action: "preview" })).rows); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function process(reconcile?: Row) {
    if (!rows) return;
    setBusy(true); setError("");
    const next = [...rows];
    try {
      for (const row of reconcile ? [reconcile] : rows.filter(row => row.ready)) {
        try {
          const result = await request({ action: reconcile ? "reconcile" : "create", containerId: row.id, token: row.token });
          next[next.findIndex(saved => saved.id === row.id)] = { ...row, ...result, ready: false,
            canReconcile: ["creation_uncertain", "rating_uncertain", "blocked"].includes(result.state) };
        } catch (cause) {
          next[next.findIndex(saved => saved.id === row.id)] = { ...row, ready: false, issue: (cause as Error).message };
        }
        setRows([...next]);
      }
      await onCreated();
    } finally { setBusy(false); }
  }
  return <section className="booking-load-sync" aria-label="Temporary Houston dray import">
    <strong>Houston booking import</strong>
    <p>5300 (SUPPBAT1) → HOUPORT · HLOCA · FLAT</p>
    <label>Order date <input type="date" required value={date} disabled={disabled || busy}
      onChange={event => { setDate(event.target.value); setRows(null); }} /></label>{" "}
    <button type="button" className="booking-charge-button" disabled={disabled || busy || !date} onClick={() => void preview()}>
      {busy ? "Processing…" : "Preview McLeod import"}
    </button>
    {rows && <>
      <p>Uses the saved container, mark, shipping order, SCM file number, carrier pay, and Houston customer rates. Created orders stay Available.</p>
      {rows.some(row => row.ready) && <button type="button" className="booking-charge-button" disabled={disabled || busy} onClick={() => void process()}>
        Create / rate eligible orders ({rows.filter(row => row.ready).length})
      </button>}
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr>{["Load", "Mark", "Container", "Carrier", "Pay", "Bill", "SCM order", "Status"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td>{row.sequence}</td><td>{row.mark}</td><td>{row.container || "—"}</td><td>{row.carrier || "—"}</td>
          <td>{row.pay?.toFixed(2) ?? "—"}</td><td>{row.bill?.toFixed(2) ?? "—"}</td><td>{row.orderId || "—"}</td>
          <td>{row.state} · {row.issue}
            {row.canReconcile && <button type="button" disabled={disabled || busy} onClick={() => void process(row)}>Check existing order</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
