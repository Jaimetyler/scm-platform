"use client";

import { useRef, useState } from "react";
import { approvalCharges, compareApprovalOrders, defaultApprovalSelection, type ApprovalRate } from "@/lib/dray/approval-charges";
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
  const [negotiatedFuel, setNegotiatedFuel] = useState(true);
  const [approvalRate, setApprovalRate] = useState<ApprovalRate | null>(null);
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
      setApprovalRate(data.approvalRate);
      setNegotiatedFuel(data.negotiatedFuel ?? true);
      setResults(data.results);
      setSelected(defaultApprovalSelection<NonNullable<Order["charges"]>[number]>(
        (data.results as Result[]).flatMap(result => result.orders), data.approvalRate, data.negotiatedFuel ?? true));
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
  const orderRows = [...orders.values()].map(({ order, marks }) => {
    const breakdown = approvalCharges<NonNullable<Order["charges"]>[number]>(order.total, order.charges, approvalRate, negotiatedFuel);
    return { id: order.id, total: order.total, chargesAvailable: order.charges !== null,
      marks: [...marks].sort().join(", "), ...breakdown,
      charges: breakdown.extras.map(charge => ({ ...charge, label: charge.description || charge.code || "Extra charge" })) };
  }).sort(compareApprovalOrders);
  const rows = orderRows.flatMap(row => row.charges);
  const chosen = orderRows.filter(order => selected.has(order.id)).flatMap(order => order.charges);
  const sum = (charges: typeof rows) => currency(charges.reduce((total, charge) =>
    total + Math.round((charge.amount ?? 0) * 100), 0) / 100);
  const total = sum(chosen);
  const reviewTotal = (amounts: (number | null)[]) => {
    const known = amounts.filter(amount => amount !== null);
    return !known.length ? "—" : currency(known.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100)
      + (known.length < amounts.length ? " (partial)" : "");
  };
  const drayage = (order: typeof orderRows[number]) => currency(order.standardTotal);
  const grouped = new Map<string, typeof orderRows>();
  for (const order of orderRows) {
    const group = grouped.get(order.marks);
    if (group) group.push(order); else grouped.set(order.marks, [order]);
  }
  const sortedGroups = [...grouped].flatMap(([marks, orders]) => [
    [marks, orders.filter(order => (order.extraTotal ?? 0) > 0)] as const,
    [marks, orders.filter(order => (order.extraTotal ?? 0) <= 0)] as const,
  ]).filter(([, orders]) => orders.length).sort(([, a], [, b]) => compareApprovalOrders(
    { extraTotal: a.some(order => (order.extraTotal ?? 0) > 0) ? 1 : 0, total: a.reduce((sum, order) => sum + (order.total ?? 0), 0) },
    { extraTotal: b.some(order => (order.extraTotal ?? 0) > 0) ? 1 : 0, total: b.reduce((sum, order) => sum + (order.total ?? 0), 0) }));
  const emailGroups = [...grouped].flatMap(([marks, orders]) => {
    const selectedOrders = orders.filter(order => selected.has(order.id));
    const extras = selectedOrders.flatMap(order => order.charges);
    return extras.length ? [{ marks, orders: selectedOrders, subtotal: sum(extras),
      markTotal: reviewTotal(orders.map(order => order.total)) }] : [];
  });
  const chargeLabel = (charge: typeof rows[number]) => {
    if (charge.includedAmount && charge.amount !== null && approvalRate?.chassisDailyRate) {
      const days = Math.round(charge.amount * 100) / Math.round(approvalRate.chassisDailyRate * 100);
      if (Number.isInteger(days) && days > 0) return days === 1 ? "Extra chassis day" : `Extra chassis · ${days} days`;
      return "Additional chassis";
    }
    return clean(charge.label);
  };
  const describe = (charge: typeof rows[number]) => `${chargeLabel(charge)} · ${currency(charge.amount)}`;
  const verifiedStandard = approvalRate !== null;
  const approvalLabel = verifiedStandard ? "Additional charges for approval" : "Itemized charges for review";
  const standardLabel = verifiedStandard ? "Standard" : "Drayage";
  const intro = `${verifiedStandard ? "Please review and approve the additional charges" : "Please review the itemized charges"} for booking ${clean(bookingNumber)}${customerReference ? ` (customer ref. ${clean(customerReference)})` : ""}.`;
  const standardNote = verifiedStandard
    ? `Standard includes drayage${negotiatedFuel ? ", FSC" : ""} and ${approvalRate.includedChassisDays} chassis day(s) at ${currency(approvalRate.chassisDailyRate)} per day.`
    : "Customer rate allowances are not configured. Itemized charges are shown in full for review; no standard chassis or fuel allowance has been deducted.";
  const includedTotal = reviewTotal(orderRows.filter(order => selected.has(order.id)).map(order => order.total));
  const email = ["Hi,", "", intro, standardNote, "",
    ...emailGroups.flatMap(group => [
      ...group.orders.map(order => `${group.marks} | SCM order number ${order.id} | ${standardLabel} ${drayage(order)} | ${order.charges.map(describe).join("; ")} | Total ${currency(order.total)}`),
      ...(group.orders.length > 1 ? [`Mark ${group.marks} total: ${group.markTotal} | Additional charges: ${group.subtotal}`] : []), ""]),
    `${approvalLabel}: ${total}`, `Full total (selected loads): ${includedTotal}`,
    "", "Thank you."].join("\n");

  async function copyEmail() {
    if (!chosen.length) return;
    const cell = "padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:left;";
    const moneyCell = `${cell}text-align:right;white-space:nowrap;`;
    let rowIndex = 0;
    const htmlRows = emailGroups.map(group => group.orders.map(order => {
      const shade = rowIndex++ % 2 ? "#f8fafc" : "#ffffff";
      return `<tr style="background-color:${shade};color:#1e293b"><td style="${cell}font-weight:600;white-space:nowrap">${escape(group.marks)}</td><td style="${cell}white-space:nowrap">${escape(order.id)}</td><td style="${moneyCell}">${escape(drayage(order))}</td><td style="${cell}">${order.charges.map(charge => `${escape(chargeLabel(charge))} &middot; <strong>${escape(currency(charge.amount))}</strong>`).join("<br>")}</td><td style="${moneyCell}font-weight:700">${escape(currency(order.total))}</td></tr>`;
    }).join("") + (group.orders.length > 1 ? `<tr style="background-color:#f1f5f9;color:#334155"><td colspan="3" style="${cell}font-weight:700">Mark ${escape(group.marks)} total</td><td style="${cell}">Additional: <strong>${escape(group.subtotal)}</strong></td><td style="${moneyCell}font-weight:700">${escape(group.markTotal)}</td></tr>` : "")).join("");
    const heading = "padding:10px 12px;border-bottom:2px solid #cbd5e1;text-align:left;font-size:12px;color:#475569;background-color:#f1f5f9;";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#1e293b;background-color:#ffffff"><p>Hi,</p><p>${escape(intro)}</p><p style="color:#64748b;font-size:12px">${escape(standardNote)}</p><table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:850px;font-family:Arial,Helvetica,sans-serif;font-size:13px"><thead><tr><th style="${heading}">Mark</th><th style="${heading}">SCM order number</th><th style="${heading}text-align:right">${escape(standardLabel)}</th><th style="${heading}">${verifiedStandard ? "Additional charges" : "Itemized charges"}</th><th style="${heading}text-align:right">Total</th></tr></thead><tbody>${htmlRows}</tbody></table><p style="margin-top:18px;font-size:15px"><strong>${escape(approvalLabel)}: ${escape(total)}</strong><br><span style="font-size:12px;color:#64748b">Full total (selected loads): ${escape(includedTotal)}</span></p><p>Thank you.</p></div>`;
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
        <div><h2 id="booking-charge-title">{verifiedStandard ? "Extra charges for approval" : "McLeod charges"}</h2><p>Booking {bookingNumber} · DDRAY</p></div>
        <button type="button" className="booking-charge-button" onClick={() => dialog.current?.close()}>Close</button>
      </header>
      <div className="booking-charge-body">
        <p>Select a load to include its itemized charges in the email. {standardNote} {verifiedStandard && "Extras appear first, highest total first."}</p>
        {busy && <p role="status">Looking up McLeod charges…</p>}
        {error && <p role="alert">{error}</p>}
        {results && <div className="booking-charge-overview">
          <div><span>Matched order totals</span><strong>{reviewTotal(orderRows.map(order => order.total))}</strong></div>
          <div><span>Matching orders</span><strong>{orders.size}</strong></div>
          <div><span>Selected for {verifiedStandard ? "approval" : "review"}</span><strong>{total}</strong></div>
        </div>}
        {results?.filter(result => result.error || !result.orders.length).map(result =>
          <p key={result.mark}>{result.mark} · {result.error || "No matching DDRAY order"}</p>)}
        {!!orderRows.length && <div className="booking-charge-table"><table>
          <thead><tr><th scope="col">Include</th><th scope="col">Mark</th><th scope="col">SCM order number</th>
            <th scope="col">{standardLabel}</th><th scope="col">{verifiedStandard ? "Extra charges" : "Itemized charges"}</th>
            <th scope="col" className="booking-charge-amount">Order total</th>
            <th scope="col" className="booking-charge-amount">Mark total</th></tr></thead>
          {sortedGroups.map(([marks, orders], groupIndex) => <tbody key={`${marks}-${groupIndex}`}>
            {orders.map((order, index) => <tr key={order.id} className={selected.has(order.id) ? "booking-charge-selected" : undefined}>
              <td><input type="checkbox" aria-label={`Include load ${order.id} for ${marks}`} checked={selected.has(order.id)}
                disabled={!order.charges.length || order.extraTotal === null}
                onChange={event => {
                  const checked = event.target.checked;
                  setCopyStatus("");
                  setSelected(previous => {
                    const next = new Set(previous);
                    if (checked) next.add(order.id); else next.delete(order.id);
                    return next;
                  });
                }} /></td>
              {index === 0 && <th scope="rowgroup" rowSpan={orders.length}>{marks}</th>}
              <td>#{order.id}{(order.extraTotal ?? 0) > 0 && <span className="booking-charge-pill">{verifiedStandard ? "Extra" : "Review"} {currency(order.extraTotal)}</span>}
                {order.extraTotal === null && <span className="booking-charge-pill booking-charge-review">Review charges</span>}</td>
              <td>{drayage(order)}{order.includedChassis > 0 && <small>Includes {currency(order.includedChassis)} chassis</small>}</td>
              <td>{!order.charges.length && <small>{order.chargesAvailable ? "No extra charges" : "Charge lines unavailable"}</small>}
                {order.charges.map((charge, index) => <div key={index} className="booking-charge-choice">
                  <span>{charge.label}{charge.includedAmount > 0 && <small>{currency(charge.includedAmount)} standard chassis excluded</small>}{!charge.includedAmount && charge.units !== null && charge.rate !== null &&
                    <small>{charge.units} × {currency(charge.rate)}</small>}</span>
                  <strong>{currency(charge.amount)}</strong>
                </div>)}
              </td>
              <td className="booking-charge-amount">{currency(order.total)}</td>
              {index === 0 && <td rowSpan={orders.length} className="booking-charge-amount"><strong>{reviewTotal((grouped.get(marks) ?? []).map(order => order.total))}</strong></td>}
            </tr>)}
          </tbody>)}
        </table></div>}
        {!!chosen.length && <details><summary>Email preview</summary>
          <textarea aria-label="Email preview" readOnly value={email} rows={10} />
        </details>}
      </div>
      <footer>
        <button type="button" className="booking-charge-button" disabled={busy} onClick={() => void lookup()}>Refresh charges</button>
        <strong>{selected.size} loads selected · {total} {verifiedStandard ? "in extras" : "to review"}</strong>
        <button type="button" className="booking-charge-button" disabled={!chosen.length || busy} onClick={() => void copyEmail()}>{verifiedStandard ? "Copy approval email" : "Copy review email"}</button>
        <span role="status">{copyStatus}</span>
      </footer>
    </dialog>
  </>;
}
