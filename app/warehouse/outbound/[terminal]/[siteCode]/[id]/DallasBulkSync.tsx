"use client";

import { useState } from "react";

type Review = {
  orderId: string;
  token?: string;
  parts: string[];
  issues: string[];
  applied?: string[];
};

type BookingLoad = { sequence: number; orderId?: string | null; issue?: string };

export default function DallasBulkSync({ bookingId, bookingLoads, selectedOrderIds, disabled, onBusy }: {
  bookingId: string; bookingLoads: BookingLoad[]; selectedOrderIds: string[]; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [action, setAction] = useState<"preview" | "send" | null>(null);
  const [scope, setScope] = useState<"booking" | "selected" | null>(null);
  const bookingOrderIds = [...new Set(bookingLoads.flatMap(load => load.orderId && !load.issue ? [load.orderId] : []))];
  const skipped = bookingLoads.filter(load => load.issue);
  const sendable = reviews.filter(row => row.token && row.parts.length);

  async function sync(send: boolean, target: "booking" | "selected") {
    if (disabled || action) return;
    if (!send) {
      setScope(target);
      setReviews([]);
    }
    setAction(send ? "send" : "preview");
    onBusy(true);
    const previous = new Map(reviews.map(row => [row.orderId, row]));
    try {
      const next: Review[] = [];
      const orderIds = send ? reviews.map(row => row.orderId) : target === "booking" ? bookingOrderIds : [...new Set(selectedOrderIds)];
      for (const orderId of orderIds) {
        const reviewed = previous.get(orderId);
        if (send && (!reviewed?.token || !reviewed.parts.length)) {
          if (reviewed) next.push(reviewed);
          continue;
        }
        try {
          const response = await fetch("/api/dray-import/dallas", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: send ? "apply-carrier" : "preview-carrier", bookingId, orderId, token: reviewed?.token }),
          });
          const result = await response.json();
          if (!response.ok) throw Error(result.error || "McLeod sync failed.");
          next.push(send ? { orderId, parts: [], applied: result.applied, issues: result.issues } : {
            orderId, token: result.token,
            parts: [result.canSendPay && "Carrier and base pay", result.canSendExtras && "Other Carrier Pay",
              result.canSendBilling && "Customer charges"].filter(Boolean),
            issues: [...new Set<string>([...result.blockers, ...result.extrasBlockers, ...result.billingBlockers])],
          });
        } catch (error) {
          next.push({ orderId, parts: [], issues: [error instanceof Error ? error.message : "McLeod sync failed."] });
        }
        setReviews([...next]);
      }
      setReviews(next);
    } finally {
      onBusy(false);
      setAction(null);
    }
  }

  return <section aria-label="Bulk McLeod sync" className="booking-load-sync">
    <button type="button" className="booking-charge-button" disabled={disabled || Boolean(action)} onClick={() => void sync(false, "booking")}>
      {action === "preview" && scope === "booking" ? "Previewing booking…" : "Sync booking"}
    </button>
    {!!selectedOrderIds.length && <button type="button" className="booking-charge-button" disabled={disabled || Boolean(action)}
      onClick={() => void sync(false, "selected")}>
      {action === "preview" && scope === "selected" ? "Previewing selected loads…" : `Sync selected loads (${selectedOrderIds.length})`}
    </button>}
    {!!sendable.length && scope && <button type="button" className="booking-charge-button" disabled={disabled || Boolean(action)}
      onClick={() => void sync(true, scope)}>
      {action === "send" ? "Sending…" : `Send reviewed differences (${sendable.length})`}
    </button>}
    {scope && !action && <p role="status">
      {sendable.length ? `${sendable.length} ready to send · ` : ""}
      {reviews.filter(row => row.applied?.length).length ? `${reviews.filter(row => row.applied?.length).length} verified · ` : ""}
      {reviews.filter(row => !row.parts.length && !row.applied?.length && !row.issues.length).length} already match ·{" "}
      {reviews.filter(row => row.issues.length).length + (scope === "booking" ? skipped.length : 0)} need review
    </p>}
    {scope === "booking" && !!skipped.length && <details>
      <summary>{skipped.length} loads skipped</summary>
      <ul>{skipped.map(load => <li key={load.sequence}>Load {load.sequence}{load.orderId && ` · ${load.orderId}`} · {load.issue}</li>)}</ul>
    </details>}
    {!!reviews.length && <ul aria-live="polite">{reviews.map(row => <li key={row.orderId}>
      <strong>{row.orderId}</strong>{" · "}
      {row.applied?.length ? `Verified ${row.applied.join(", ")}` : row.parts.length ? row.parts.join(", ") :
        row.issues.length ? "Review required" : "Already matches"}
      {!!row.issues.length && <small style={{ display: "block" }}>{row.issues.join(" · ")}</small>}
    </li>)}</ul>}
  </section>;
}
