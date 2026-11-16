"use client";

import { useState } from "react";

type PayLine = { code: string | null; description: string; amount: number | null };
type CarrierReview = { token: string; currentPayee: string; assignedCarrier: string; currentPay: number | null;
  carrier: string; pay: number; otherPay: PayLine[] | null; proposedExtras: PayLine[]; blockers: string[]; billingBlockers: string[]; billed: PayLine[] | null; proposedBilling: PayLine[]; extrasBlockers: string[]; canSendPay: boolean; canSendExtras: boolean; canSendBilling: boolean; fuelChanges: string[] };
const money = (amount: number | null) => amount == null ? "Unavailable" :
  amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
const payLines = (lines: PayLine[] | null) => lines == null ? "Unavailable" : lines.length ?
  lines.map(line => [line.code, line.description, money(line.amount)].filter(Boolean).join(" · ")).join(", ") : "None";

export default function DallasLoadSync({ bookingId, orderId, disabled }: { bookingId: string; orderId: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [bolt, setBolt] = useState(false);
  const [review, setReview] = useState<{ token: string; changes: { field: string; before: string; after: string }[] } | null>(null);
  const [carrierReview, setCarrierReview] = useState<CarrierReview | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sync(apply: boolean, carrier = false) {
    setBusy(true);
    setError("");
    setMessage("");
    setCarrierReview(null);
    setReview(null);
    try {
      const response = await fetch("/api/dray-import/dallas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: `${apply ? "apply" : "preview"}-${carrier ? "carrier" : "details"}`,
          bookingId, orderId, boltSealsRequired: bolt, token: carrier ? carrierReview?.token : review?.token, fields }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Booking details sync failed.");
      if (carrier) {
        if (apply) {
          if (result.applied.length) setMessage(`Verified in McLeod: ${result.applied.join(", ")}.`);
          if (result.issues.length) setError(result.issues.join(" · "));
          if (!result.applied.length && !result.issues.length) setMessage("Carrier pay and charges already match.");
        }
        else setCarrierReview(result);
      } else if (apply) {
        setReview(null);
        setMessage(result.verified ? `Verified selected booking details on SCM order ${orderId}.` :
          `Read-back did not verify: ${result.differences.join(", ")}. Preview again before applying.`);
      } else {
        setReview(result);
        setFields(result.changes.filter((change: { before: string }) => !change.before).map((change: { field: string }) => change.field));
      }
    } catch (cause) {
      if (apply) setReview(null);
      setError(cause instanceof Error ? cause.message : "Booking details sync failed.");
    } finally { setBusy(false); }
  }

  return <section aria-label={`McLeod sync for SCM order ${orderId}`} className="booking-load-sync">
    <strong>SCM order {orderId}</strong>{" "}
    <fieldset disabled={busy || disabled} style={{ border: 0, margin: 0, padding: 0 }}>
      <label><input type="checkbox" disabled={busy} checked={bolt} onChange={event => {
        setBolt(event.target.checked); setReview(null);
      }} /> Bolt seals required</label>{" "}
      <button type="button" className="booking-charge-button" disabled={!orderId || busy} onClick={() => void sync(false)}>Preview booking details</button>
      <button type="button" className="booking-charge-button" disabled={!orderId || busy}
        onClick={() => void sync(false, true)}>Preview pay and charges</button>
      {carrierReview && <section aria-label="Carrier and pay comparison">
        {[...new Set([...carrierReview.blockers, ...carrierReview.extrasBlockers, ...carrierReview.billingBlockers])].map(blocker =>
          <p key={blocker} role="status">{blocker}</p>)}
        <button type="button" className="booking-charge-button"
          disabled={busy || !(carrierReview.canSendPay || carrierReview.canSendExtras || carrierReview.canSendBilling || carrierReview.fuelChanges.length)}
          onClick={() => void sync(true, true)}>Send pay and charge differences</button>
        {!!carrierReview.fuelChanges.length && <p>{carrierReview.fuelChanges.join(" · ")}</p>}
        <div className="booking-charge-table"><table>
          <thead><tr><th>Field</th><th>McLeod</th><th>Platform</th></tr></thead>
          <tbody>
            <tr><th scope="row">Carrier payee</th><td>{carrierReview.currentPayee || "Blank"}</td><td>{carrierReview.carrier}</td></tr>
            <tr><th scope="row">Dispatched carrier</th><td>{carrierReview.assignedCarrier || "Blank"}</td><td>Review in McLeod</td></tr>
            <tr><th scope="row">Base carrier pay</th><td>{money(carrierReview.currentPay)}</td><td>{money(carrierReview.pay)}</td></tr>
            <tr><th scope="row">Customer charges to add or increase</th><td>{payLines(carrierReview.billed)}</td><td>{payLines(carrierReview.proposedBilling)}</td></tr>
            <tr><th scope="row">Other Carrier Pay</th><td>{payLines(carrierReview.otherPay)}</td><td>{payLines(carrierReview.proposedExtras)}</td></tr>
          </tbody>
        </table></div>
      </section>}
      {review && (review.changes.length ? <>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, margin: "12px 0" }}>
          <button type="button" className="booking-charge-button" style={{ background: "#285647", color: "#f5faf7", borderColor: "#81a797" }}
            disabled={busy || !fields.length} onClick={() => void sync(true)}>
            {busy ? "Applying…" : "Apply selected details"}
          </button>
          <span>{fields.length ? `${fields.length} selected · SCM order ${orderId}` :
            "Select the fields below to enable Apply."}</span>
        </div>
        <div className="booking-charge-table"><table>
          <thead><tr><th>Apply</th><th>McLeod field</th><th>Current</th><th>Proposed</th></tr></thead>
          <tbody>{review.changes.map(change => <tr key={change.field}>
            <td><input type="checkbox" aria-label={`Apply ${change.field}`} disabled={busy} checked={fields.includes(change.field)}
              onChange={event => setFields(event.target.checked ? [...fields, change.field] : fields.filter(field => field !== change.field))} /></td>
            <th scope="row">{change.field}</th><td>{change.before || "Blank"}</td><td>{change.after}</td>
          </tr>)}</tbody>
        </table></div>
      </> : <p role="status">The booking details already match.</p>)}
      {message && <p role="status">{message}</p>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>;
}
