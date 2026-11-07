"use client";

import { useState } from "react";
import type { InboundTerminal } from "@/lib/bunge/destinations";
import type { DispatchInput } from "./DispatchUpload";
import styles from "../cotton-locations/outreach/outreach.module.css";
import layout from "./importer.module.css";

type Preflight = {
  canCreate?: boolean; reviewToken?: string; mcleodOrderId?: string | null;
  ok?: boolean; reason?: string; error?: string; auditStatus?: string;
};
async function requestPreflight(input: DispatchInput, salesOrder: string, terminal: InboundTerminal, reviewToken?: string): Promise<Preflight> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("equipment", input.equipment);
  form.set("destination", input.destination);
  form.set("salesOrder", salesOrder);
  form.set("terminal", terminal);
  if (reviewToken) {
    form.set("action", "create-pilot");
    form.set("reviewToken", reviewToken);
  }
  const response = await fetch("/api/cotton-import/preflight", { method: "POST", body: form });
  return response.json();
}

export default function BatchCreate({ terminal, submission, orders, onBusy }: {
  terminal: InboundTerminal; submission: DispatchInput; orders: string[]; onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<{ so: string; outcome: string }[]>([]);
  const [batchCurrent, setBatchCurrent] = useState("");

  async function createBatch() {
    if (busy) return;
    if (!window.confirm("Create eligible orders from this workbook in live McLeod? Each order will be checked for duplicates first.")) return;
    setBusy(true);
    onBusy(true);
    setBatchResults([]);
    const report = (so: string, outcome: string) => setBatchResults(rows => [...rows, { so, outcome }]);

    try {
      for (const so of new Set(orders)) {
        setBatchCurrent(so);
        const review = await requestPreflight(submission, so, terminal);
        if (!review.canCreate || !review.reviewToken) {
          report(so, `Skipped · ${review.error || review.reason || "Preflight did not allow creation."}`);
          continue;
        }
        const created = await requestPreflight(submission, so, terminal, review.reviewToken);
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
        <button type="button" disabled={busy} onClick={() => void createBatch()}>
          Create all eligible orders
        </button>
        <span>Checks each order for duplicates before creating it.</span>
      </div>
      <div aria-live="polite">
        {busy && <p>Batch checking or creating SO {batchCurrent}…</p>}
        {!!batchResults.length && <section className={styles.guide} aria-label="Batch results">
          <h3>Batch results</h3>
          <ul>{batchResults.map(row => <li key={row.so}><strong>{row.so}</strong> · {row.outcome}</li>)}</ul>
        </section>}
      </div>
  </>;
}
