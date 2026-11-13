"use client";

import { useState } from "react";
import type { InboundTerminal } from "@/lib/bunge/destinations";
import type { DispatchInput } from "./DispatchUpload";
import styles from "../cotton-locations/outreach/outreach.module.css";
import layout from "./importer.module.css";

function LocationWarning({ outcome }: { outcome: string }) {
  const match = /(?:Inactive location|Ambiguous location code|Unknown location code): ([A-Z0-9_-]+)\.?$/i.exec(outcome);
  if (!match) return outcome;
  const code = match[1];
  const start = match.index + match[0].indexOf(": ") + 2;
  return <>{outcome.slice(0, start)}<a style={{ color: "#7dd3fc", textDecoration: "underline" }}
    href={`/cotton-locations?location=${encodeURIComponent(code)}`} target="_blank" rel="noopener noreferrer">{code}</a>{outcome.slice(start + code.length)}</>;
}

type Preflight = {
  canCreate?: boolean; reviewToken?: string; mcleodOrderId?: string | null;
  ok?: boolean; reason?: string; error?: string; auditStatus?: string;
};
async function requestPreflight(input: DispatchInput, salesOrder: string, terminal: InboundTerminal, reviewToken?: string, destination?: string, customerId?: string): Promise<Preflight> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("equipment", input.equipment);
  form.set("destination", destination ?? input.destination);
  if (customerId) form.set("customerId", customerId);
  form.set("salesOrder", salesOrder);
  form.set("terminal", terminal);
  if (reviewToken) {
    form.set("action", "create-pilot");
    form.set("reviewToken", reviewToken);
  }
  const response = await fetch("/api/cotton-import/preflight", { method: "POST", body: form });
  return response.json();
}

export default function BatchCreate({ terminal, submission, orders, onBusy, destination, customerId, disabled = false }: {
  terminal: InboundTerminal; submission: DispatchInput; orders: string[]; onBusy: (busy: boolean) => void;
  destination?: string; customerId?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<{ so: string; outcome: string }[]>([]);
  const [batchCurrent, setBatchCurrent] = useState("");

  async function createBatch() {
    if (busy || disabled) return;
    if (!window.confirm("Create eligible orders from this workbook in live McLeod? Each order will be checked for duplicates first.")) return;
    setBusy(true);
    onBusy(true);
    setBatchResults([]);
    const report = (so: string, outcome: string) => setBatchResults(rows => [...rows, { so, outcome }]);

    try {
      for (const so of new Set(orders)) {
        setBatchCurrent(so);
        const review = await requestPreflight(submission, so, terminal, undefined, destination, customerId);
        if (!review.canCreate || !review.reviewToken) {
          report(so, `Skipped · ${review.error || review.reason || "Preflight did not allow creation."}`);
          continue;
        }
        const created = await requestPreflight(submission, so, terminal, review.reviewToken, destination, customerId);
        if (created.ok && created.auditStatus === "verified" && created.mcleodOrderId) {
          report(so, `Created and verified · SCM order #${created.mcleodOrderId}`);
          continue;
        }
        report(so, `Batch stopped · ${created.mcleodOrderId ? `SCM order #${created.mcleodOrderId} · ` : ""}${created.error || created.reason || "Create could not be verified."}`);
        break;
      }
    } catch (cause) {
      report("Batch", `Stopped · ${cause instanceof Error ? cause.message : "Request failed."} Check the audit before running again.`);
    } finally {
      setBatchCurrent("");
      setBusy(false);
      onBusy(false);
    }
  }

  return <>
      <div className={layout.actions}>
        <button type="button" disabled={busy || disabled || !orders.length || (customerId === "OLAMRITX" && !destination)} onClick={() => void createBatch()}>
          Create eligible orders in McLeod
        </button>
        <span>Checks each order for duplicates before creating it.</span>
      </div>
      <div aria-live="polite">
        {busy && <p>Batch checking or creating SO {batchCurrent}…</p>}
        {!!batchResults.length && <section className={styles.guide} aria-label="Batch results">
          <h3>Batch results</h3>
          <ul>{batchResults.map(row => <li key={row.so}><strong>{row.so}</strong> · <LocationWarning outcome={row.outcome} /></li>)}</ul>
        </section>}
      </div>
  </>;
}
