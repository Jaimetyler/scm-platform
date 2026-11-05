"use client";

import { useState } from "react";
import styles from "../cotton-locations/outreach/outreach.module.css";
import layout from "./importer.module.css";
import type { reviewPickupEquipment } from "@/lib/cotton-import/equipment";
import BatchCreate from "./BatchCreate";
import DispatchUpload, { equipmentLabels, type DispatchInput } from "./DispatchUpload";

type Window = {
  locationCode: string; originalRtlDate: string; early: string | null;
  late: string | null; status: string; reason: string;
};
type Review = {
  salesOrder: string; status: string; reason: string; pickupWindows?: Window[];
  equipment?: ReturnType<typeof reviewPickupEquipment>;
  pickupPolicies?: { locationCode: string; versions: {
    status: string; rules: { rule_kind: string; fee_type: string; amount: number; grace_days: number }[];
  }[] }[];
  preview?: { blnum: string };
};
type Result = {
  filename: string; destination: string; counts: { orders: number; pickupLines: number; blocked: number; sourceErrors: number };
  reviews: Review[]; sourceErrors: { row: number; reason: string }[];
};
const feeUnits: Record<string, string> = {
  PER_BALE_ONE_TIME: "per bale, one time",
  PER_BALE_PER_DAY: "per bale per day",
};

export default function HoustonPreviewClient() {
  const [submission, setSubmission] = useState<DispatchInput | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "batch" | null>(null);
  const [error, setError] = useState("");


  function clear() {
    setResult(null);
    setError("");
    setSubmission(null);
  }

  async function preview(input: DispatchInput) {
    if (busy) return;
    clear();
    setBusy("preview");
    try {
      const form = new FormData();
      form.set("file", input.file);
      form.set("equipment", input.equipment);
      form.set("destination", input.destination);
      const response = await fetch("/api/cotton-import/upload", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Preview failed.");
      setResult(data);
      setSubmission(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  return <section aria-label="Houston dispatch preview">
    <DispatchUpload terminal="houston" busy={!!busy} onPreview={preview} onChange={clear} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {result && <section className={layout.results}>
      <h2>Review Houston orders</h2>
      <p>{result.filename} · {result.destination}</p>
      <div className={styles.stats}>
        <span><b>{result.counts.orders}</b> Grouped orders</span>
        <span><b>{result.counts.pickupLines}</b> Pickup lines</span>
        <span><b>{result.counts.blocked}</b> Blocked orders</span>
        <span><b>{result.counts.sourceErrors}</b> Source issues</span>
      </div>
      {!!result.sourceErrors.length && <details className={styles.guide}>
        <summary>Review source issues</summary>
        {result.sourceErrors.map(issue => <p key={issue.row}>Row {issue.row} · {issue.reason}</p>)}
      </details>}
      {submission && <BatchCreate terminal="houston" submission={submission}
        orders={result.reviews.map(row => row.salesOrder)} onBusy={value => setBusy(value ? "batch" : null)} />}
      <div className={styles.tableWrap}><table>
        <thead><tr><th scope="col">Order</th><th scope="col">Pickup and RTL</th>
          <th scope="col">Equipment</th><th scope="col">Late-fee policy</th><th scope="col">Review</th></tr></thead>
        <tbody>{result.reviews.map((review, index) => {
          const blocked = review.status === "blocked";
          const ready = !review.equipment?.reason && !!review.pickupWindows?.length && review.pickupWindows.every(window => window.status === "ready");
          return <tr key={`${review.salesOrder}-${index}`}>
            <td><strong>{review.salesOrder}</strong><small>{review.preview?.blnum ?? "—"}</small></td>
            <td>{review.pickupWindows?.map((window, stop) => <div className={layout.stop} key={stop}>
              <strong>{window.locationCode}</strong> · {window.originalRtlDate}
              <small>{window.early ?? "?"}–{window.late ?? "?"}{window.status !== "ready" && ` · ${window.reason}`}</small>
            </div>) || "—"}</td>
            <td>{review.equipment?.choice && <strong>{equipmentLabels[review.equipment.choice]}</strong>}
              {review.equipment?.stops.map((stop, index) => <small key={index}>
                {stop.locationCode} · {stop.accepted === "van_only" ? "Van only" : stop.accepted === "van_and_flatbed" ? "Van or tarped flatbed" : "Unknown"}
              </small>)}
            </td>
            <td>{review.pickupPolicies?.map((policy, stop) => {
              const rules = policy.versions.flatMap(version => version.rules
                .filter(rule => rule.rule_kind === "late_pickup").map(rule => ({ ...rule, status: version.status })));
              return <div className={layout.stop} key={stop}><strong>{policy.locationCode}</strong>
                {rules.length ? rules.map((rule, index) => <small key={index}>
                  ${rule.amount} {feeUnits[rule.fee_type] ?? rule.fee_type} · {rule.grace_days} grace days · {rule.status}
                </small>) : <small>No late-fee rule</small>}
              </div>;
            }) || "—"}</td>
            <td><span className={ready ? layout.ready : layout.review}>{blocked ? "Blocked" : ready ? "Hours ready" : "Needs review"}</span>
              {!ready && <small>{review.equipment?.reason || review.reason}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>}
  </section>;
}
