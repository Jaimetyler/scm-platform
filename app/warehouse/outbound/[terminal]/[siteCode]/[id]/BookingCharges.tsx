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
  const orderRows = [...orders.values()].map(({ order, marks }) => ({
    id: order.id, total: order.total, rate: order.rate, rateUnits: order.rateUnits, chargesAvailable: order.charges !== null, marks: [...marks].sort().join(", "),
    charges: (order.charges ?? []).map((charge, index) => ({ ...charge, key: `${order.id}:${index}`,
      label: charge.description || charge.code || "Extra charge" })),
  }));
  const rows = orderRows.flatMap(row => row.charges);
  const chosen = rows.filter(charge => selected.has(charge.key) && charge.amount !== null);
  const sum = (charges: typeof rows) => currency(charges.reduce((total, charge) =>
    total + Math.round((charge.amount ?? 0) * 100), 0) / 100);
  const total = sum(chosen);
  const reviewTotal = (amounts: (number | null)[]) => {
    const known = amounts.filter(amount => amount !== null);
    return !known.length ? "—" : currency(known.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100)
      + (known.length < amounts.length ? " (partial)" : "");
  };
  const drayage = (order: typeof orderRows[number]) => order.rate === null ? "—" :
    `${currency(order.rate)}${order.rateUnits !== null && order.rateUnits !== 1 ? ` × ${order.rateUnits}` : ""}`;
  const grouped = new Map<string, typeof orderRows>();
  for (const order of orderRows) {
    const group = grouped.get(order.marks);
    if (group) group.push(order); else grouped.set(order.marks, [order]);
  }
  const emailGroups = [...grouped].flatMap(([marks, orders]) => {
    const selectedOrders = orders.map(order => ({ ...order,
      charges: order.charges.filter(charge => selected.has(charge.key) && charge.amount !== null),
    }));
    const extras = selectedOrders.flatMap(order => order.charges);
    return extras.length ? [{ marks, orders: selectedOrders, subtotal: sum(extras),
      markTotal: reviewTotal(orders.map(order => order.total)) }] : [];
  });
  const describe = (charge: typeof rows[number]) => `${clean(charge.label)} — ${currency(charge.amount)}${charge.units !== null && charge.rate !== null ? ` (${charge.units} × ${currency(charge.rate)})` : ""}`;
  const intro = `Please review and approve the additional charges for booking ${clean(bookingNumber)}${customerReference ? ` (customer ref. ${clean(customerReference)})` : ""}.`;
  const email = ["Hi,", "", intro, "",
    ...emailGroups.flatMap(group => [`Mark ${group.marks}`,
      ...group.orders.map(order => `Order #${order.id} | Drayage rate: ${drayage(order)} | Order total: ${currency(order.total)}${order.charges.length ? ` | Extras: ${order.charges.map(describe).join(" · ")}` : ""}`),
      `Mark total incl. drayage: ${group.markTotal} | Extras for approval: ${group.subtotal}`, ""]),
    `Total for approval: ${total}`, "", "Thank you."].join("\n");

  async function copyEmail() {
    if (!chosen.length) return;
    const htmlRows = emailGroups.map(group => group.orders.map(order =>
      `<tr><td>${escape(group.marks)}</td><td>${escape(order.id)}</td><td>${escape(drayage(order))}</td><td>${order.charges.map(charge => escape(describe(charge))).join("<br>") || "—"}</td><td>${escape(currency(order.total))}</td></tr>`
    ).join("") + `<tr><td colspan="3"><strong>Mark total · ${escape(group.marks)}</strong></td><td>Extras for approval: ${escape(group.subtotal)}</td><td><strong>${escape(group.markTotal)}</strong></td></tr>`).join("");
    const html = `<p>Hi,</p><p>${escape(intro)}</p><table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>Mark</th><th>Order</th><th>Drayage rate</th><th>Extras for approval</th><th>Order total</th></tr></thead><tbody>${htmlRows}</tbody></table><p><strong>Total for approval: ${escape(total)}</strong></p><p>Thank you.</p>`;
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
        <p>Order and mark totals include drayage. Check only the extras you want to send for approval.</p>
        {busy && <p role="status">Looking up McLeod charges…</p>}
        {error && <p role="alert">{error}</p>}
        {results && <div className="booking-charge-overview">
          <div><span>Matched order totals</span><strong>{reviewTotal(orderRows.map(order => order.total))}</strong></div>
          <div><span>Matching orders</span><strong>{orders.size}</strong></div>
          <div><span>Selected for approval</span><strong>{total}</strong></div>
        </div>}
        {results?.filter(result => result.error || !result.orders.length).map(result =>
          <p key={result.mark}>{result.mark} · {result.error || "No matching DDRAY order"}</p>)}
        {!!orderRows.length && <div className="booking-charge-table"><table>
          <thead><tr><th scope="col">McLeod order</th><th scope="col">Drayage rate</th><th scope="col">Extras · check to include</th>
            <th scope="col" className="booking-charge-amount">Order total</th></tr></thead>
          {[...grouped].map(([marks, orders]) => <tbody key={marks}>
            <tr className="booking-charge-mark">
              <th scope="rowgroup" colSpan={3}>{marks}</th>
              <td className="booking-charge-amount"><strong>{reviewTotal(orders.map(order => order.total))}</strong><small>Mark total incl. drayage</small></td>
            </tr>
            {orders.map(order => <tr key={order.id}>
              <td>#{order.id}</td><td>{drayage(order)}</td>
              <td>{!order.charges.length && <small>{order.chargesAvailable ? "No itemized charges" : "Charge lines unavailable"}</small>}{order.charges.map(charge => <label key={charge.key} className="booking-charge-choice">
                <input type="checkbox" aria-label={`Include ${charge.label} on order ${order.id}`} checked={selected.has(charge.key)}
                  disabled={charge.amount === null} onChange={event => {
                    const checked = event.target.checked;
                    setCopyStatus("");
                    setSelected(previous => {
                      const next = new Set(previous);
                      if (checked) next.add(charge.key); else next.delete(charge.key);
                      return next;
                    });
                  }} />
                <span>{charge.label}{charge.units !== null && charge.rate !== null &&
                  <small>{charge.units} × {currency(charge.rate)}</small>}</span>
                <strong>{currency(charge.amount)}</strong>
              </label>)}</td>
              <td className="booking-charge-amount">{currency(order.total)}</td>
            </tr>)}
          </tbody>)}
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
