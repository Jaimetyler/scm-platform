"use client";

import { useRef, useState, type FormEvent } from "react";
import type { previewToyoSourceLoads } from "@/lib/warehouse/outbound/source-loads";
import styles from "../cotton-locations/outreach/outreach.module.css";
import layout from "../bunge-import/importer.module.css";

type Preview = ReturnType<typeof previewToyoSourceLoads>;
type DuplicateCheck = { busy: true } | { message: string; clear?: boolean };
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function SourceLoadsPage() {
  const [result, setResult] = useState<Preview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<number, DuplicateCheck>>({});
  const [cutoffTime, setCutoffTime] = useState("");
  const [creating, setCreating] = useState<number | null>(null);
  const [created, setCreated] = useState<Record<number, string>>({});
  const revision = useRef(0);

  function clearPreview() {
    revision.current++;
    setResult(null);
    setChecks({});
    setCreated({});
    setCutoffTime("");
    setError("");
  }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    const body = new FormData();
    body.set("file", file);
    clearPreview();
    setBusy(true);
    try {
      const response = await fetch("/api/source-loads", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not preview the dispatch.");
      setResult(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview the dispatch.");
    } finally {
      setBusy(false);
    }
  }

  async function checkDuplicates(line: Preview["lines"][number]) {
    if (!result || !line.blnum || !line.readyDate) return;
    const current = revision.current;
    setChecks(previous => ({ ...previous, [line.sourceRow]: { busy: true } }));
    let check: DuplicateCheck;
    try {
      const response = await fetch("/api/bunge-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "duplicates", customerId: result.customerId,
          blnum: line.blnum, pickupDates: [line.readyDate],
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.matches))
        throw Error(data.error || "Duplicate lookup failed.");
      check = data.matches.length
        ? { message: `${data.matches.length} existing McLeod match(es)` }
        : { message: "No matching orders", clear: true };
    } catch (reason) {
      check = { message: reason instanceof Error ? reason.message : "Duplicate lookup failed." };
    }
    if (revision.current === current) setChecks(previous => ({ ...previous, [line.sourceRow]: check }));
  }

  async function createOrder(line: Preview["lines"][number]) {
    if (!file || !result || !line.mcleodDraft || creating !== null) return;
    if (!window.confirm(`Create ${line.blnum} in live McLeod at ${dollars.format(line.mcleodDraft.rate)}?`)) return;
    setCreating(line.sourceRow);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("action", "create");
      body.set("sourceRow", String(line.sourceRow));
      body.set("cutoffTime", cutoffTime);
      const response = await fetch("/api/source-loads", { method: "POST", body });
      const data = await response.json();
      setCreated(previous => ({ ...previous, [line.sourceRow]: data.verified
        ? `Created and verified · SCM order #${data.orderId}`
        : [data.orderId && `SCM order #${data.orderId}`, data.error || "Creation could not be verified."].filter(Boolean).join(" · ") }));
    } catch {
      setCreated(previous => ({ ...previous, [line.sourceRow]: "Request failed. Check McLeod before retrying." }));
    } finally {
      setCreating(null);
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>DOMESTIC COTTON</p>
        <h1>Source Loads Importer</h1>
        <p>Review Houston Toyo dispatches, return terminals and base rates.</p>
      </div>
    </header>
    <form className={styles.guide} onSubmit={preview}>
      <h2>Upload dispatch</h2>
      <p>Toyo Cotton Houston · XLSX up to 3 MB</p>
      <div className={layout.actions}>
        <input aria-label="Dispatch workbook" type="file" accept=".xlsx" disabled={busy || creating !== null} onChange={event => {
          setFile(event.target.files?.[0] ?? null);
          clearPreview();
        }} />
        <button type="submit" disabled={busy || creating !== null || !file}>{busy ? "Working…" : "Preview dispatch"}</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
    {result && <section className={layout.results} aria-label="Source load preview">
      <h2>Booking {result.booking}</h2>
      <dl className={layout.addresses}>
        <div><dt>Customer / Revenue / Order type</dt><dd>{result.customerId} / {result.revenueCode} / {result.orderType}</dd></div>
        <div><dt>Equipment release</dt><dd>{result.equipmentRelease || "—"}</dd></div>
        <div><dt>Loaded return</dt><dd>{result.loadedReturn || "—"} {result.returnCode && `(${result.returnCode})`}</dd></div>
        <div><dt>ERD</dt><dd>{result.erd || "—"}</dd></div>
        <div><dt>Doc Cut</dt><dd>{result.docCutoff || "—"}</dd></div>
        <div><dt>Cutoff</dt><dd>{result.cutoff || "—"}</dd></div>
        <div><dt>Total base rate</dt><dd>{result.totalBaseRate === null ? "—" : dollars.format(result.totalBaseRate)}</dd></div>
      </dl>
      <p><strong>Planning comment</strong> {result.planningComment}</p>
      {result.issues.map(issue => <p key={issue} role="alert" className={styles.error}>{issue}</p>)}
      {result.cutoff?.length === 10 && <div className={layout.actions}>
        <label>Confirmed loaded-return cutoff time (Houston local){" "}
          <input type="time" value={cutoffTime} disabled={creating !== null} onChange={event => setCutoffTime(event.target.value)} />
        </label>
      </div>}
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Order references</th><th>Pickup and loaded return</th><th>Bales / Weight</th><th>Base rate</th><th>Review</th><th>McLeod duplicates</th><th>McLeod order</th></tr></thead>
          <tbody>{result.lines.map(line => {
            const check = checks[line.sourceRow];
            const checking = check && "busy" in check;
            const cutoffDay = line.readyDate && line.readyDate === result.cutoff?.slice(0, 10);
            return <tr key={line.sourceRow}>
              <td><strong>{line.blnum ?? line.mark}</strong><small>Consignee ref {line.consignee_refno || "—"}</small>
                {line.ordered_by && <small>Ordered by {line.ordered_by}</small>}</td>
              <td>{line.pickupCode ?? line.warehouseCode} {line.city}<small>{line.readyDate ?? "—"}</small>
                {line.mcleodDraft && <small>Loaded return {line.mcleodDraft.stops[1].location_id}</small>}</td>
              <td>{line.bales ?? "—"} / {line.weight?.toLocaleString("en-US") ?? "—"}</td>
              <td>{line.baseRate === null ? "—" : dollars.format(line.baseRate)}</td>
              <td><span className={line.issues.length || cutoffDay ? layout.review : layout.ready}>
                {line.issues.length ? "Needs review" : cutoffDay ? "Ready on cutoff day" : "Mapped"}
              </span>{line.issues.map(issue => <small key={issue}>{issue}</small>)}</td>
              <td><button type="button" onClick={() => void checkDuplicates(line)}
                disabled={checking || !line.blnum || !line.readyDate}>{checking ? "Checking…" : "Check duplicates"}</button>
                {check && "message" in check && <small role="status">{check.message}</small>}</td>
              <td><button type="button" onClick={() => void createOrder(line)}
                disabled={creating !== null || !line.mcleodDraft || !(result.cutoff?.slice(11, 16) || cutoffTime) ||
                  Boolean(created[line.sourceRow])}>
                {creating === line.sourceRow ? "Creating…" : "Create in McLeod"}
              </button>{created[line.sourceRow] && <small role="status">{created[line.sourceRow]}</small>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>}
  </main>;
}
