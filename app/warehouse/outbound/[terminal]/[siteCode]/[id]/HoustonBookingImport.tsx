"use client";
import { useState } from "react";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";

type Row = {
  id: string; sequence: number; mark: string; container: string | null; bill?: number; pay?: number;
  previousBill?: number | null; previousPay?: number | null; customerCharges?: { code: string; description: string; units: number; amount: number }[];
  carrier?: string; state: string; orderId: string | null; issue: string; token: string | null;
  ready: boolean; canReconcile: boolean; canRepair: boolean; canSync: boolean;
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
  async function process(reconcile?: Row, repair = false, sync = false) {
    if (!rows) return;
    setBusy(true); setError("");
    const next = [...rows];
    try {
      for (const row of reconcile ? [reconcile] : rows.filter(row => sync ? row.canSync : row.ready)) {
        try {
          const result = await request({ action: sync ? "sync" : reconcile ? repair ? "repair" : "reconcile" : "create", containerId: row.id, token: row.token });
          next[next.findIndex(saved => saved.id === row.id)] = { ...row, ...result, ready: false, canSync: false, canRepair: result.state === "blocked" && Boolean(result.orderId),
            canReconcile: ["creation_uncertain", "rating_uncertain", "blocked"].includes(result.state) };
        } catch (cause) {
          next[next.findIndex(saved => saved.id === row.id)] = { ...row, ready: false, canSync: false, canRepair: false, canReconcile: true, issue: (cause as Error).message };
        }
        setRows([...next]);
      }
      await onCreated();
    } finally { setBusy(false); }
  }
  return <section id="houston-booking-import" className="booking-load-sync" style={{ scrollMarginTop: 24 }} aria-label="Temporary Houston dray import">
    <strong>Houston booking import</strong>
    <p>5300 (SUPPBAT1) → HOUPORT · HLOCA · FLAT</p>
    <label>Order date <input type="date" required value={date} disabled={disabled || busy}
      onChange={event => { setDate(event.target.value); setRows(null); }} /></label>{" "}
    <button type="button" className="booking-charge-button" disabled={disabled || busy || !date} onClick={() => void preview()}>
      {busy ? "Processing…" : "Preview McLeod import"}
    </button>
    {rows && <>
      <p>Uses saved booking details, carrier pay, and Houston customer rates. Shipping order is optional for ED&F. Created orders stay Available.</p>
      {rows.some(row => row.ready) && <button type="button" className="booking-charge-button" disabled={disabled || busy} onClick={() => void process()}>
        Create / rate eligible orders ({rows.filter(row => row.ready).length})
      </button>}
      {rows.some(row => row.canSync) && <button type="button" className="booking-charge-button" disabled={disabled || busy}
        onClick={() => void process(undefined, false, true)}>Sync carrier pay / customer charges ({rows.filter(row => row.canSync).length})</button>}
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr>{["Load", "Mark", "Container", "Carrier", "Pay", "Bill", "SCM order", "Status"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td>{row.sequence}</td><td>{row.mark}</td><td>{row.container || "—"}</td><td>{row.carrier || "—"}</td>
          <td>{row.canSync && row.previousPay != null && <small>{row.previousPay.toFixed(2)} → </small>}{row.pay?.toFixed(2) ?? "—"}</td>
          <td>{row.canSync && row.previousBill != null && <small>{row.previousBill.toFixed(2)} → </small>}{row.bill?.toFixed(2) ?? "—"}
            {row.customerCharges?.map(charge => <small key={charge.code + charge.description} style={{ display: "block" }}>
              {charge.description} · {charge.units} · ${charge.amount.toFixed(2)}
            </small>)}
          </td><td>{row.orderId || "—"}</td>
          <td>{row.state} · {row.issue}
            {row.canRepair && <button type="button" disabled={disabled || busy} onClick={() => void process(row, true)}>Finish existing order</button>}
            {row.canReconcile && <button type="button" disabled={disabled || busy} onClick={() => void process(row)}>Check existing order</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
