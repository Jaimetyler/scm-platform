"use client";

import { Fragment, useRef, useState } from "react";
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
  const orderRows = [...orders.values()].map(({ order, marks }) => ({
    id: order.id, marks: [...marks].sort().join(", "),
    charges: (order.charges ?? []).map((charge, index) => ({ ...charge, key: `${order.id}:${index}`,
      label: charge.description || charge.code || "Extra charge" })),
  })).filter(row => row.charges.length);
  const rows = orderRows.flatMap(row => row.charges);
  const chosen = rows.filter(charge => selected.has(charge.key) && charge.amount !== null);
  const sum = (charges: typeof rows) => currency(charges.reduce((total, charge) =>
    total + Math.round((charge.amount ?? 0) * 100), 0) / 100);
  const total = sum(chosen);
  const grouped = new Map<string, typeof orderRows>();
  for (const order of orderRows) {
    const group = grouped.get(order.marks);
    if (group) group.push(order); else grouped.set(order.marks, [order]);
  }
  const emailGroups = [...grouped].flatMap(([marks, orders]) => {
    const selectedOrders = orders.map(order => ({ ...order,
      charges: order.charges.filter(charge => selected.has(charge.key) && charge.amount !== null),
    })).filter(order => order.charges.length);
    return selectedOrders.length ? [{ marks, orders: selectedOrders, subtotal: sum(selectedOrders.flatMap(order => order.charges)) }] : [];
  });
  const describe = (charge: typeof rows[number]) => `${clean(charge.label)} — ${currency(charge.amount)}${charge.units !== null && charge.rate !== null ? ` (${charge.units} × ${currency(charge.rate)})` : ""}`;
  const intro = `Please review and approve the additional charges for booking ${clean(bookingNumber)}${customerReference ? ` (customer ref. ${clean(customerReference)})` : ""}.`;
  const email = ["Hi,", "", intro, "",
    ...emailGroups.flatMap(group => [`Mark ${group.marks}`,
      ...group.orders.map(order => `Order #${order.id}: ${order.charges.map(describe).join(" · ")} | ${sum(order.charges)}`),
      `Mark subtotal: ${group.subtotal}`, ""]),
    `Total for approval: ${total}`, "", "Thank you."].join("\n");

  async function copyEmail() {
    if (!chosen.length) return;
    const htmlRows = emailGroups.map(group => group.orders.map(order =>
      `<tr><td>${escape(group.marks)}</td><td>${escape(order.id)}</td><td>${order.charges.map(charge => escape(describe(charge))).join("<br>")}</td><td>${escape(sum(order.charges))}</td></tr>`
    ).join("") + `<tr><td colspan="3"><strong>Mark subtotal · ${escape(group.marks)}</strong></td><td><strong>${escape(group.subtotal)}</strong></td></tr>`).join("");
    const html = `<p>Hi,</p><p>${escape(intro)}</p><table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>Mark</th><th>Order</th><th>Extra charges</th><th>Amount</th></tr></thead><tbody>${htmlRows}</tbody></table><p><strong>Total for approval: ${escape(total)}</strong></p><p>Thank you.</p>`;
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
          <thead><tr>{["Mark", "McLeod order", "Charges", "Selected total"].map(label =>
            <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{[...grouped].map(([marks, orders]) => <Fragment key={marks}>
            {orders.map(order => <tr key={order.id}>
              <td>{marks}</td><td>{order.id}</td>
              <td>{order.charges.map(charge => <label key={charge.key} style={{ display: "block" }}>
                <input type="checkbox" aria-label={`Include ${charge.label} on order ${order.id}`} checked={selected.has(charge.key)}
                  disabled={charge.amount === null} onChange={event => {
                    const checked = event.target.checked;
                    setCopyStatus("");
                    setSelected(previous => {
                      const next = new Set(previous);
                      if (checked) next.add(charge.key); else next.delete(charge.key);
                      return next;
                    });
                  }} /> {describe(charge)}
              </label>)}</td>
              <td>{sum(order.charges.filter(charge => selected.has(charge.key)))}</td>
            </tr>)}
            <tr><th scope="row" colSpan={3}>Mark subtotal · {marks}</th>
              <td><strong>{sum(orders.flatMap(order => order.charges).filter(charge => selected.has(charge.key)))}</strong></td></tr>
          </Fragment>)}</tbody>
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
