"use client";
import { bookingReturnLocationLabel } from "@/lib/warehouse/outbound/return-location";
import { attachBookingFile } from "@/lib/warehouse/outbound/upload-client";

import { planOutboundDrayLoads } from "@/lib/dray/outbound-load-plan";
import { useState, type FormEvent } from "react";
import type { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";
import styles from "../../ecotton-import/review.module.css";

type Preview = ReturnType<typeof previewDallasBungeDrays>;

export default function DallasDrayPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bookId, setBookId] = useState("");
  const [details, setDetails] = useState({ erd: "", docCutoff: "", cutoff: "", vessel: "", steamshipLine: "" });
  const [check, setCheck] = useState<{ key: string; bookings: string[]; orders: { id: string; blnum: string }[]; error?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [saved, setSaved] = useState<{ bookingId: string; siteCode: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setPreview(null);
    setSaved(null);
    setError("");
    setBusy(true);
    try {
      const file = form.get("booking");
      if (!(file instanceof File)) throw Error("Choose a booking request.");
      await attachBookingFile(form, file, "DAL", undefined, "booking");
      const response = await fetch("/api/dray-import/dallas", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || "Booking preview failed.");
      setPreview(result.preview);
      const parsed: Preview = result.preview;
      setBookId(parsed.bookId);
      setDetails({ erd: parsed.erd ?? "", docCutoff: parsed.docCutoff ?? "", cutoff: parsed.cutoff ?? "",
        vessel: parsed.vessel ?? "", steamshipLine: parsed.steamshipLine ?? "" });
      setCheck(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Booking preview failed.");
    } finally {
      setBusy(false);
    }
  }

  let loads: ReturnType<typeof planOutboundDrayLoads> = [];
  let loadIssue = "";
  if (preview) {
    try { loads = planOutboundDrayLoads(bookId, preview.containers, preview.pickupLocation, preview.deliveryLocation); }
    catch (reason) { loadIssue = reason instanceof Error ? reason.message : "Could not plan loads."; }
  }

  const checkKey = JSON.stringify([bookId, details]);
  async function checkBooking() {
    if (!preview || !loads.length || checking) return;
    setChecking(true);
    setCheck(null);
    try {
      const response = await fetch("/api/dray-import/dallas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingNumber: preview.bookingNumber, bookId, containers: preview.containers,
          pickup: preview.pickupLocation, delivery: preview.deliveryLocation, details }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Duplicate check failed.");
      setCheck({ key: checkKey, ...result });
    } catch (cause) {
      setCheck({ key: checkKey, bookings: [], orders: [], error: cause instanceof Error ? cause.message : "Duplicate check failed." });
    } finally { setChecking(false); }
  }

  async function importBooking() {
    const form = document.querySelector<HTMLFormElement>("#dallas-booking-upload");
    if (!form || importing || saved) return;
    setImporting(true);
    setError("");
    try {
      const data = new FormData(form);
      const file = data.get("booking");
      if (!(file instanceof File) || !file.size) throw Error("Choose a booking request.");
      await attachBookingFile(data, file, "DAL", undefined, "booking");
      for (const [key, value] of Object.entries({ ...details, bookId, action: "import" })) data.set(key, value);
      const response = await fetch("/api/dray-import/dallas", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not save booking.");
      setSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save booking.");
    } finally { setImporting(false); }
  }

  return <main className={styles.page}>
    <h1>Dallas Dray Import</h1>
    <p>Review a Bunge, Olam, or ED&F booking request before creating outbound dray orders.</p>
    <form id="dallas-booking-upload" className={styles.toolbar} onSubmit={upload}>
      <label>Booking request <input required name="booking" type="file" accept=".xlsx,.xlsb" disabled={busy || checking || importing}
        onChange={() => { setPreview(null); setError(""); }} /></label>
      <button type="submit" disabled={busy || checking || importing}>{busy ? "Reading…" : "Preview booking"}</button>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {preview && <section>
      <h2>Booking {preview.bookingNumber}</h2>
      <dl className={styles.summary}>
        {([
          ["Customer", preview.customer], ["Customer reference", preview.customerReference],
          ["Load port / ramp", bookingReturnLocationLabel(preview.loadPort, preview.deliveryLocation)], ["McLeod delivery", preview.deliveryLocation],
          ["Containers", preview.containers], ["Total bales", preview.totalBales || "Not supplied"],
          ...preview.sourceDates.map(date => [date.label, date.value]),
        ] as [string, string | number | null | undefined][]).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
      </dl>
      {preview.issues.map(issue => <p key={issue} className={styles.error}>{issue}</p>)}
      <h3>Review booking details</h3>
      <div className={styles.toolbar}>
        <label>Book ID <input value={bookId} placeholder="Enter Book ID" onChange={event => setBookId(event.target.value)} /></label>
        <label>ERD <input type="date" value={details.erd} onChange={event => setDetails({ ...details, erd: event.target.value })} /></label>
        {(["docCutoff", "cutoff"] as const).map(field => <label key={field}>
          {field === "docCutoff" ? "Doc cutoff" : "Cutoff"}{" "}
          <input type="date" value={details[field].slice(0, 10)} onChange={event => {
            const date = event.target.value;
            setDetails({ ...details, [field]: date ? date + details[field].slice(10) : "" });
          }} />{" "}
          <input type="time" aria-label={field === "docCutoff" ? "Doc cutoff time" : "Cutoff time"}
            disabled={!details[field]} value={details[field].slice(11, 16)} onChange={event => {
              const time = event.target.value;
              setDetails({ ...details, [field]: details[field].slice(0, 10) + (time ? "T" + time : "") });
            }} />
        </label>)}
        <label>Vessel / voyage <input value={details.vessel} onChange={event => setDetails({ ...details, vessel: event.target.value })} /></label>
        <label>Steamship line <input value={details.steamshipLine} onChange={event => setDetails({ ...details, steamshipLine: event.target.value })} /></label>
      </div>
      <h3>Planned McLeod loads</h3>
      <button type="button" disabled={!loads.length || checking} onClick={() => void checkBooking()}>
        {checking ? "Checking platform and McLeod…" : "Check for duplicates"}
      </button>
      {check?.key === checkKey && <div role="status">
        {check.error ? <p className={styles.error}>{check.error}</p> : <>
          <p>{check.bookings.length ? `Existing platform booking at ${check.bookings.join(", ")}.` : "No existing platform booking found."}</p>
          <p>{check.orders.length ? `Existing McLeod orders: ${check.orders.map(order => `${order.id} (${order.blnum || "no BLNUM"})`).join(", ")}.` : "No matching McLeod orders found."}</p>
        </>}
      </div>}
      {loadIssue && <p role="status">{loadIssue}</p>}
      {check?.key === checkKey && !check.error && !check.bookings.length && !check.orders.length && !saved &&
        <button type="button" disabled={importing || checking} onClick={() => void importBooking()}>
          {importing ? "Saving…" : "Save booking and stage McLeod orders"}
        </button>}
      {saved && <p role="status"><a href={`/warehouse/outbound/dal/${saved.siteCode}/${saved.bookingId}`}>Open saved booking to create McLeod orders</a></p>}
      {loads.length > 0 && <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th scope="col">Load</th><th scope="col">Initial BLNUM</th><th scope="col">Pickup</th><th scope="col">Delivery</th></tr></thead>
        <tbody>{loads.map(load => <tr key={load.sequence}>
          <td>{load.sequence}</td><td>{load.originalBlnum}</td><td>{load.pickup}</td><td>{load.delivery}</td>
        </tr>)}</tbody>
      </table></div>}
      <details>
      <summary>Available marks ({preview.lines.length})</summary>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr>{["Shipping order", "Mark", "Container", "Bales", "Load by", "McLeod pickup", "McLeod delivery", "Review"].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{preview.lines.map(line => <tr key={line.sourceRow}>
          <td>{line.shippingOrder || "—"}</td><td>{line.mark}</td><td>{line.containerNumber || "—"}</td><td>{line.bales || "Not supplied"}</td>
          <td>{line.loadBy || "—"}{line.confirmed ? " · Confirmed" : ""}</td>
          <td>{line.pickupLocation || line.warehouse || "Unmapped"}</td><td>{preview.deliveryLocation || "Unmapped"}</td>
          <td>{line.issues.join(" ") || "—"}</td>
        </tr>)}</tbody>
      </table></div>
      </details>
    </section>}
  </main>;
}
