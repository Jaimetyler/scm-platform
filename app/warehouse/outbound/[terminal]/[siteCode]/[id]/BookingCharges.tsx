"use client";

import { useRef, useState } from "react";
import type { readBookingMarkCharges } from "@/lib/dray/booking-charges";

type Order = Awaited<ReturnType<typeof readBookingMarkCharges>>[number];
type Result = { mark: string; orders: Order[]; error?: string };
const currency = (amount: number | null) => amount === null ? "—" : amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
const clean = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();
const escape = (value: string) => clean(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export default function BookingCharges({ bookingId, bookingNumber, customerReference }: {
  bookingId: string; bookingNumber: string; customerReference?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  async function lookup() {
    setBusy(true);
    setError("");
    setCopyStatus("");
    setResults(null);
    setSelected(new Set());
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${bookingId}/charges`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error || "Charge lookup failed.");
      setResults(data.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Charge lookup failed.");
    } finally { setBusy(false); }
  }

  const orders = new Map<string, { order: Order; marks: Set<string> }>();
  for (const result of results ?? []) {
    for (const order of result.orders) {
      const existing = orders.get(order.id);
      if (existing) existing.marks.add(result.mark);
      else orders.set(order.id, { order, marks: new Set([result.mark]) });
    }
  }
  const rows = [...orders.values()].flatMap(({ order, marks }) =>
    (order.charges ?? []).map((charge, index) => ({ ...charge, key: `${order.id}:${index}`,
      orderId: order.id, marks: [...marks].join(", "), label: charge.description || charge.code || "Extra charge" })));
  const chosen = rows.filter(row => selected.has(row.key) && row.amount !== null);
  const total = currency(chosen.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) / 100);
  const intro = `Please review and approve the additional charges for booking ${clean(bookingNumber)}${customerReference ? ` (customer ref. ${clean(customerReference)})` : ""}.`;
  const email = ["Hi,", "", intro, "",
    ...chosen.map(row => `• ${clean(row.label)} — ${currency(row.amount)} (mark ${row.marks}, order #${row.orderId})${row.units !== null && row.rate !== null ? ` · ${row.units} × ${currency(row.rate)}` : ""}`),
    "", `Total for approval: ${total}`, "", "Thank you."].join("\n");

  async function copyEmail() {
    if (!chosen.length) return;
    const cells = chosen.map(row => [row.marks, row.orderId, row.label,
      row.units === null ? "—" : String(row.units), currency(row.rate), currency(row.amount)]);
    const html = `<p>Hi,</p><p>${escape(intro)}</p><table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>Mark</th><th>Order</th><th>Extra charge</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${cells.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><p><strong>Total for approval: ${escape(total)}</strong></p><p>Thank you.</p>`;
    try {
      if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([email], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        })]).catch(() => navigator.clipboard.writeText(email));
      } else await navigator.clipboard.writeText(email);
      setCopyStatus("Copied. Paste into your email.");
    } catch { setCopyStatus("Clipboard access failed. You can copy the text from Email preview."); }
  }

  return <>
    <button ref={opener} type="button" className="booking-charge-button" onClick={() => {
      dialog.current?.showModal();
      if (!results && !busy) void lookup();
    }}>Pull McLeod charges</button>
    <dialog ref={dialog} className="booking-charge-dialog" aria-labelledby="booking-charge-title"
      onClose={() => opener.current?.focus()}>
      <header>
        <div><h2 id="booking-charge-title">Extra charges for approval</h2><p>Booking {bookingNumber} · DDRAY</p></div>
        <button type="button" className="booking-charge-button" onClick={() => dialog.current?.close()}>Close</button>
      </header>
      <div className="booking-charge-body">
        <p>Select the charges you want the customer to approve. Review quantities and rates before copying.</p>
        {busy && <p role="status">Looking up McLeod charges…</p>}
        {error && <p role="alert">{error}</p>}
        {results && <p>{orders.size} matching orders · {rows.length} charge lines</p>}
        {results?.filter(result => result.error || !result.orders.length).map(result =>
          <p key={result.mark}>{result.mark} · {result.error || "No matching DDRAY order"}</p>)}
        {[...orders.values()].filter(({ order }) => !order.charges?.length).map(({ order, marks }) =>
          <p key={order.id}>{[...marks].join(", ")} · #{order.id} · {order.charges === null ? "Charge lines unavailable" : "No itemized charges"}</p>)}
        {!!rows.length && <div className="booking-charge-table"><table>
          <thead><tr>{["Include", "Mark", "McLeod order", "Charge", "Qty", "Rate", "Amount"].map(label =>
            <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <td><input type="checkbox" aria-label={`Include ${row.label} on order ${row.orderId}`} checked={selected.has(row.key)}
              disabled={row.amount === null} onChange={event => {
                const checked = event.target.checked;
                setCopyStatus("");
                setSelected(previous => {
                  const next = new Set(previous);
                  if (checked) next.add(row.key); else next.delete(row.key);
                  return next;
                });
              }} /></td>
            <td>{row.marks}</td><td>{row.orderId}</td><td>{row.label}</td>
            <td>{row.units ?? "—"}</td><td>{currency(row.rate)}</td><td>{currency(row.amount)}</td>
          </tr>)}</tbody>
        </table></div>}
        {!!chosen.length && <details><summary>Email preview</summary>
          <textarea aria-label="Email preview" readOnly value={email} rows={10} />
        </details>}
      </div>
      <footer>
        <button type="button" className="booking-charge-button" disabled={busy} onClick={() => void lookup()}>Refresh charges</button>
        <strong>{chosen.length} selected · {total}</strong>
        <button type="button" className="booking-charge-button" disabled={!chosen.length || busy} onClick={() => void copyEmail()}>Copy approval email</button>
        <span role="status">{copyStatus}</span>
      </footer>
    </dialog>
  </>;
}
