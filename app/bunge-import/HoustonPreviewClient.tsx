"use client";

import { useRef, useState } from "react";
import styles from "../cotton-locations/outreach/outreach.module.css";
import layout from "./importer.module.css";
import type { reviewPickupEquipment } from "@/lib/cotton-import/equipment";
import BatchCreate, { PickupLocationLink, requestPreflight, type Preflight } from "./BatchCreate";
import { equipmentLabels, type DispatchInput } from "./DispatchUpload";

type Window = {
  locationCode: string; originalRtlDate: string; scheduledDate: string; early: string | null;
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

export type HoustonResult = Result;
export default function HoustonPreviewClient({ result, submission, onBusy }: {
  result: Result; submission: DispatchInput; onBusy: (busy: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [selected, setSelected] = useState<Review | null>(null);
  const [details, setDetails] = useState<Preflight | null>(null);
  const draft = details?.draft;

  async function showDetails(review: Review) {
    const id = ++request.current;
    setSelected(review);
    setDetails(review.status === "blocked" ? { reason: review.reason } : null);
    dialog.current?.showModal();
    if (review.status === "blocked") return;
    try {
      const response = await requestPreflight(submission, review.salesOrder, "houston");
      if (request.current === id) setDetails(response);
    } catch (error) {
      if (request.current === id) setDetails({ error: error instanceof Error ? error.message : "Could not load order details." });
    }
  }

  return <section aria-label="Houston dispatch preview">
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
        pickupCodes={so => result.reviews.filter(row => row.salesOrder === so).flatMap(row => row.pickupWindows?.map(stop => stop.locationCode) ?? [])} orders={result.reviews.map(row => row.salesOrder)} onBusy={onBusy} />}
      <div className={styles.tableWrap}><table>
        <thead><tr><th scope="col">Order</th><th scope="col">Pickup and RTL</th>
          <th scope="col">Equipment</th><th scope="col">Late-fee policy</th><th scope="col">Review</th><th scope="col" aria-label="Actions" /></tr></thead>
        <tbody>{result.reviews.map((review, index) => {
          const blocked = review.status === "blocked";
          const ready = !review.equipment?.reason && !!review.pickupWindows?.length && review.pickupWindows.every(window => window.status === "ready");
          return <tr key={`${review.salesOrder}-${index}`}>
            <td><strong>{review.salesOrder}</strong><small>{review.preview?.blnum ?? "—"}</small></td>
            <td>{review.pickupWindows?.map((window, stop) => <div className={layout.stop} key={stop}>
              <PickupLocationLink code={window.locationCode} /> · {window.scheduledDate}
              {window.scheduledDate !== window.originalRtlDate && <small>Original date {window.originalRtlDate} - rec&apos;d late</small>}
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
            <td><button type="button" aria-label={`Details for SO ${review.salesOrder}`} onClick={() => void showDetails(review)}>Details</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="houston-details-title" onClose={() => {
      request.current++;
      setSelected(null);
    }}>
      <header className={styles.dialogHeader}>
        <div><small>SO {selected?.salesOrder}</small><h2 id="houston-details-title">{selected?.preview?.blnum ?? "Order details"}</h2></div>
        <form method="dialog"><button type="submit">Close</button></form>
      </header>
      <div className={styles.body}>
        {selected?.pickupWindows?.map((window, index) => <p key={index}>
          <PickupLocationLink code={window.locationCode} /> · {window.scheduledDate} · {window.early && window.late ? `${window.early}–${window.late}` : window.reason}
          {window.scheduledDate !== window.originalRtlDate && <small>Original date {window.originalRtlDate} - rec&apos;d late</small>}
        </p>)}
        <p role="status">{details ? details.error || details.reason : "Checking order details…"}</p>
        {details?.delivery && <p>Delivery · {[details.delivery.name ?? details.delivery.code, details.delivery.address, draft?.deliveryDate].filter(Boolean).join(" · ")}</p>}
        {draft?.lastFreeDate && <p>Document Cutoff · {draft.lastFreeDate}</p>}
        {draft?.baseRate !== undefined && <p>Platform base rate · ${draft.baseRate.toFixed(2)}</p>}
        {draft?.order?.weight != null && <p>Order weight · {draft.order.weight.toLocaleString("en-US")} lb</p>}
        {draft?.order?.otherCharges?.map(charge => <p key={charge.charge_id}>{charge.descr} · ${charge.amount.toFixed(2)}</p>)}
        {draft?.pickupReferences?.map(reference => <p key={reference.stopSequence}>
          <PickupLocationLink code={reference.locationCode} /> · {reference.referenceNumber}
        </p>)}
        {draft?.pickupNotes?.map(note => <pre className={layout.response} key={note.stopSequence}>{note.comment}</pre>)}
      </div>
    </dialog>
  </section>;
}
