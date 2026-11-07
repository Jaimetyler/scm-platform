"use client";

import { useState, type FormEvent } from "react";
import type { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";
import styles from "../../ecotton-import/review.module.css";

type Preview = ReturnType<typeof previewDallasBungeDrays>;

export default function DallasDrayPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setPreview(null);
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/dray-import/dallas", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || "Booking preview failed.");
      setPreview(result.preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Booking preview failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.page}>
    <h1>Dallas Dray Import</h1>
    <p>Review a Bunge, Olam, or ED&F booking request before the drays run. Preview only.</p>
    <form className={styles.toolbar} onSubmit={upload}>
      <label>Booking request <input required name="booking" type="file" accept=".xlsx,.xlsb" disabled={busy}
        onChange={() => { setPreview(null); setError(""); }} /></label>
      <button type="submit" disabled={busy}>{busy ? "Reading…" : "Preview booking"}</button>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {preview && <section>
      <h2>Booking {preview.bookingNumber}</h2>
      <dl className={styles.summary}>
        {([
          ["Customer", preview.customer], ["Customer reference", preview.customerReference],
          ["Load port / ramp", preview.loadPort], ["McLeod delivery", preview.deliveryLocation],
          ["Steamship line", preview.steamshipLine], ["Vessel / voyage", preview.vessel],
          ["Containers", preview.containers], ["Total bales", preview.totalBales || "Not supplied"], ["ERD", preview.erd],
          ...preview.sourceDates.map(date => [date.label, date.value]),
        ] as [string, string | number | null | undefined][]).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
      </dl>
      {preview.issues.map(issue => <p key={issue} className={styles.error}>{issue}</p>)}
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
    </section>}
  </main>;
}
