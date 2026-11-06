"use client";
import { useState } from "react";
import PlatformPanel from "@/components/platform/PlatformPanel";
import type { readBookingMarkCharges } from "@/lib/dray/booking-charges";

type Result = { mark: string; orders: Awaited<ReturnType<typeof readBookingMarkCharges>>; error?: string };
const currency = (amount: number | null) => amount === null ? "—" : amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function BookingCharges({ bookingId }: { bookingId: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function lookup() {
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${bookingId}/charges`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error || "Charge lookup failed.");
      setResults(data.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Charge lookup failed.");
    } finally { setBusy(false); }
  }
  return <PlatformPanel>
    <h2>McLeod charges by mark</h2>
    <button type="button" disabled={busy} onClick={() => void lookup()}>{busy ? "Looking up charges…" : "Pull McLeod charges"}</button>
    {error && <p role="alert">{error}</p>}
    {results.map(result => <details key={result.mark}>
      <summary>{result.mark} · {result.error ? "Lookup incomplete" : `${result.orders.length} matching orders`}</summary>
      {result.error && <p role="alert">{result.error}</p>}
      {result.orders.map(order => <div key={order.id}>
        <p><strong>McLeod {order.id}</strong> · {order.revenueCode} · {order.status} · Base rate {currency(order.rate)}
          {order.rateUnits !== null && ` × ${order.rateUnits}`} · Order total {currency(order.total)}</p>
        {order.charges === null ? <p>McLeod did not return charge lines.</p> : order.charges.length === 0 ? <p>No other charges returned.</p> :
          <ul>{order.charges.map((charge, index) => <li key={index}>
            {charge.code} {charge.description} · {currency(charge.amount)}{charge.units !== null && ` · ${charge.units} units at ${currency(charge.rate)}`}
          </li>)}</ul>}
      </div>)}
    </details>)}
  </PlatformPanel>;
}
