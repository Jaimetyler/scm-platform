"use client";

import { useState } from "react";

type PayLine = { code: string | null; description: string; amount: number | null };
type LoadReview = { detailChanges: { field: string; before: string; after: string }[]; detailBlockers: string[]; canSendDetails: boolean; token: string; currentPayee: string; assignedCarrier: string; currentPay: number | null;
  carrier: string | null; pay: number; otherPay: PayLine[] | null; proposedExtras: PayLine[]; blockers: string[]; billingBlockers: string[]; billed: PayLine[] | null; proposedBilling: PayLine[]; extrasBlockers: string[]; canSendPay: boolean; canSendExtras: boolean; canSendBilling: boolean; fuelChanges: string[] };
const money = (amount: number | null) => amount == null ? "Unavailable" :
  amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
const payLines = (lines: PayLine[] | null) => lines == null ? "Unavailable" : lines.length ?
  lines.map(line => [line.code, line.description, money(line.amount)].filter(Boolean).join(" · ")).join(", ") : "None";

export default function DallasLoadSync({ bookingId, orderId, disabled, onContainerPull }: { bookingId: string; orderId: string; disabled: boolean; onContainerPull: () => void }) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<LoadReview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sync(apply: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    setReview(null);
    try {
      const response = await fetch("/api/dray-import/dallas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: apply ? "apply-load" : "preview-load", bookingId, orderId, token: review?.token }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "McLeod sync failed.");
      if (apply) {
        if (result.applied.length) setMessage(`Verified: ${result.applied.join(", ")}.`);
        if (result.applied.includes("Container pulled from McLeod")) onContainerPull();
        if (result.issues.length) setError(result.issues.join(" · "));
        if (!result.applied.length && !result.issues.length) setMessage("This load already matches McLeod.");
      } else setReview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "McLeod sync failed.");
    } finally { setBusy(false); }
  }

  return <section aria-label={`McLeod sync for SCM order ${orderId}`} className="booking-load-sync">
    <strong>SCM order {orderId}</strong>{" "}
    <fieldset disabled={busy || disabled} style={{ border: 0, margin: 0, padding: 0 }}>
      <button type="button" className="booking-charge-button" onClick={() => void sync(false)}>Preview McLeod sync</button>
      {review && <>
        {[...new Set([...review.detailBlockers, ...review.blockers, ...review.extrasBlockers, ...review.billingBlockers])].map(blocker =>
          <p key={blocker} role="status">{blocker}</p>)}
        <button type="button" className="booking-charge-button"
          disabled={!(review.canSendDetails || review.canSendPay || review.canSendExtras || review.canSendBilling || review.fuelChanges.length)}
          onClick={() => void sync(true)}>Send reviewed changes</button>
        {!!review.fuelChanges.length && <p>{review.fuelChanges.join(" · ")}</p>}
        {!!review.detailChanges.length && <div className="booking-charge-table"><table>
          <thead><tr><th>Booking detail</th><th>Current</th><th>Proposed</th></tr></thead>
          <tbody>{review.detailChanges.map(change => <tr key={change.field}>
            <th scope="row">{change.field === "blnum" ? "Mark" : change.field === "consignee_refno" ? "Container" : change.field}</th>
            <td>{change.before || "Blank"}</td><td>{change.after}</td>
          </tr>)}</tbody>
        </table></div>}
        {review.carrier && <div className="booking-charge-table"><table>
          <thead><tr><th>Field</th><th>McLeod</th><th>Platform</th></tr></thead>
          <tbody>
            <tr><th scope="row">Carrier payee</th><td>{review.currentPayee || "Blank"}</td><td>{review.carrier}</td></tr>
            <tr><th scope="row">Dispatched carrier</th><td>{review.assignedCarrier || "Blank"}</td><td>Review in McLeod</td></tr>
            <tr><th scope="row">Base carrier pay</th><td>{money(review.currentPay)}</td><td>{money(review.pay)}</td></tr>
            <tr><th scope="row">Customer charges to add or increase</th><td>{payLines(review.billed)}</td><td>{payLines(review.proposedBilling)}</td></tr>
            <tr><th scope="row">Other Carrier Pay</th><td>{payLines(review.otherPay)}</td><td>{payLines(review.proposedExtras)}</td></tr>
          </tbody>
        </table></div>}
      </>}
      {message && <p role="status">{message}</p>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>;
}
