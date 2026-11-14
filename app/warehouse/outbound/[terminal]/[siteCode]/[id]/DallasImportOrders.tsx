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
  const [orderId, setOrderId] = useState("");
  const [bolt, setBolt] = useState(false);
  const [review, setReview] = useState<{ token: string; changes: { field: string; before: string; after: string }[] } | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [message, setMessage] = useState("");
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

  async function sync(apply: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    if (!apply) setReview(null);
    try {
      const response = await fetch("/api/dray-import/dallas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: apply ? "apply-details" : "preview-details",
          bookingId, orderId, boltSealsRequired: bolt, token: review?.token, fields }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Booking details sync failed.");
      if (apply) {
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

  const linked = loads.filter(load => load.state === "verified" && load.orderId);
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
    {linked.length > 0 && <details>
      <summary className="booking-charge-button">Sync booking details to McLeod</summary>
      <label>SCM order <select disabled={busy} value={orderId} onChange={event => {
        setOrderId(event.target.value); setReview(null); setMessage("");
      }}>
        <option value="">Select a verified order</option>
        {linked.map(load => <option key={load.blnum} value={load.orderId!}>{load.orderId} · {load.blnum}</option>)}
      </select></label>{" "}
      <label><input type="checkbox" disabled={busy} checked={bolt} onChange={event => {
        setBolt(event.target.checked); setReview(null);
      }} /> Bolt seals required</label>{" "}
      <button type="button" className="booking-charge-button" disabled={!orderId || busy} onClick={() => void sync(false)}>Preview booking details</button>
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
    </details>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
