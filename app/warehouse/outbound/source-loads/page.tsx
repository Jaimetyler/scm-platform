"use client";

import { useState, type FormEvent } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import type { previewToyoSourceLoads } from "@/lib/warehouse/outbound/source-loads";
import styles from "../outbound.module.css";

type Preview = ReturnType<typeof previewToyoSourceLoads>;
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function SourceLoadsPage() {
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/warehouse/outbound/source-loads", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not preview the dispatch.");
      setResult(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview the dispatch.");
    } finally {
      setBusy(false);
    }
  }

  return <main>
    <PlatformPageHeader title="Import Source Loads" subtitle="Preview a Toyo Cotton Houston dray dispatch." />
    <PlatformPanel>
      <form onSubmit={preview} className={styles.uploadForm}>
        <label>Dispatch workbook <input name="file" type="file" accept=".xlsx" required disabled={busy} onChange={() => { setResult(null); setError(""); }} /></label>
        <button className={styles.importButton} disabled={busy}>{busy ? "Reading dispatch…" : "Preview dispatch"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <>
        <h2>Booking {result.booking}</h2>
        <p>{result.customerId} · {result.revenueCode} · {result.orderType} · {result.loadedReturn || "Return terminal missing"} {result.returnCode && `(${result.returnCode})`}</p>
        <p>{result.planningComment}</p>
        {result.totalBaseRate !== null && <p>Total base rate {dollars.format(result.totalBaseRate)}</p>}
        {result.issues.map(issue => <p key={issue} role="alert">{issue}</p>)}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Mark</th><th>Pickup</th><th>Ready date</th><th>Bales</th><th>Weight</th><th>Base rate</th><th>Review</th></tr></thead>
            <tbody>{result.lines.map(line => <tr key={line.sourceRow}>
              <td>{line.mark}</td><td>{line.pickupCode ?? line.warehouseCode} {line.city}</td>
              <td>{line.readyDate ?? "—"}</td><td>{line.bales ?? "—"}</td><td>{line.weight ?? "—"}</td>
              <td>{line.baseRate === null ? "—" : dollars.format(line.baseRate)}</td>
              <td>{line.issues.join(" ") || (line.readyDate === result.cutoff?.slice(0, 10) ? "Ready on cutoff day" : "Ready")}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </PlatformPanel>
  </main>;
}
