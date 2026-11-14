"use client";

import { useEffect, useState } from "react";
type Load = { blnum: string; state: string; orderId: string | null };

async function request(bookingId: string, action: string, signal?: AbortSignal): Promise<Load[]> {
  const response = await fetch("/api/dray-import/dallas", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ bookingId, action }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Dallas import request failed.");
  return data.loads;
}

export default function DallasImportOrders({ bookingId }: { bookingId: string }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void request(bookingId, "import-status", controller.signal).then(setLoads).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [bookingId]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      let pending = loads.filter(load => load.state === "pending").length;
      while (pending > 0) {
        const result = await request(bookingId, "create-orders");
        setLoads(result);
        const next = result.filter(load => load.state === "pending").length;
        if (next >= pending) break;
        pending = next;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Order creation failed.");
    } finally { setBusy(false); }
  }

  if (!loads.length && !error) return null;
  return <section aria-label="Dallas dray import">
    {loads.length > 0 && <>
      <button type="button" className="booking-charge-button" disabled={busy || !loads.some(load => load.state === "pending")}
        onClick={() => void create()}>{busy ? "Creating McLeod orders…" : "Create McLeod orders"}</button>
      <details open><summary>{loads.filter(load => load.state === "verified").length} of {loads.length} McLeod orders verified</summary>
        <ul>{loads.map(load => <li key={load.blnum}>{load.blnum} · {load.state === "writing" || load.state === "review" ? "Review in McLeod" : load.state}
          {load.orderId && ` · SCM order ${load.orderId}`}</li>)}</ul>
      </details>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
