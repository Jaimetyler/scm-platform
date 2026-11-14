"use client";

import { useEffect, useState } from "react";
import type { BookingSyncPreview as Preview } from "@/lib/warehouse/outbound/booking-sync-preview";

const currency = (value: number | null | undefined) =>
  value == null ? "Unavailable" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

type PayLine = { code?: string | null; description: string; amount: number | null };
function PayLines({ lines }: { lines?: PayLine[] | null }) {
  if (!lines) return "Unavailable";
  if (!lines.length) return "None";
  return <ul>{lines.map((line, index) =>
    <li key={index}>{[line.code, line.description, currency(line.amount)].filter(Boolean).join(" · ")}</li>
  )}</ul>;
}

export default function BookingSyncPreview({ bookingId }: { bookingId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void fetch(`/api/warehouse/outbound/bookings/${bookingId}/charges?view=booking-preview`, {
      cache: "no-store", signal: request.signal,
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not load the booking preview.");
      if (!request.signal.aborted) setPreview(data);
    }).catch(cause => {
      if (!request.signal.aborted) setError(cause.message || "Could not load the booking preview.");
    });
    return () => request.abort();
  }, [bookingId, attempt]);

  return <section aria-label="Booking comparison">
    <p>Read-only comparison of saved booking values and McLeod. A numbered BLNUM is shown as an order reference.</p>
    <button type="button" className="booking-charge-button" disabled={!preview && !error} onClick={() => {
      setPreview(null);
      setError("");
      setAttempt(current => current + 1);
    }}>Refresh comparison</button>
    {error ? <p role="alert">{error}</p> : !preview ? <p role="status">Comparing booking loads…</p> : <>
      <p>{preview.rows.filter(row => row.order).length} of {preview.rows.length} loads linked · {preview.unmatchedOrders.length} McLeod orders to review</p>
      <div className="booking-charge-table"><table>
        <thead><tr>{["Load", "SCM order", "Field", "Platform", "McLeod"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        {preview.rows.map(({ id, sequence, platform, order, issue }) => <tbody key={id}>
          <tr><th scope="row">#{sequence} {platform.mark}</th><td colSpan={4}>{order?.id ?? issue}{order?.status && ` · ${order.status}`}</td></tr>
          {[
            ["Mark / BLNUM", platform.mark || "—", order?.blnum || "—"],
            ["Container", platform.container || "—", order?.container || "—"],
            ["Carrier", platform.carrier || "—", order?.carrier || "—"],
            ["Base carrier pay", currency(platform.basePay), currency(order?.basePay)],
            ["Other Carrier Pay", <PayLines key="planned" lines={platform.otherPay} />, <PayLines key="actual" lines={order?.otherPay} />],
            ["Customer charges", <PayLines key="planned" lines={platform.customerCharges} />, <PayLines key="actual" lines={order?.charges} />],
          ].map(([label, local, remote]) => <tr key={String(label)}><td colSpan={2} />
            <th scope="row">{label}</th><td>{local}</td><td>{remote}</td></tr>)}
        </tbody>)}
      </table></div>
      {preview.unmatchedOrders.length > 0 && <details><summary>McLeod orders to review</summary>
        <ul>{preview.unmatchedOrders.map(order => <li key={order.id}>
          {[order.id, order.blnum, order.container, order.carrier, currency(order.basePay)].filter(Boolean).join(" · ")}
          <div>Other Carrier Pay <PayLines lines={order.otherPay} /></div>
          <div>Customer charges <PayLines lines={order.charges} /></div>
        </li>)}</ul>
      </details>}
    </>}
  </section>;
}
