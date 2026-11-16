"use client";

import { useState } from "react";

type Review = {
  orderId: string;
  token?: string;
  parts: string[];
  issues: string[];
  applied?: string[];
};

export default function DallasBulkSync({ bookingId, orderIds, disabled, onBusy }: {
  bookingId: string; orderIds: string[]; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [action, setAction] = useState<"preview" | "send" | null>(null);
  const sendable = reviews.filter(row => row.token && row.parts.length);

  async function sync(send: boolean) {
    if (disabled || action) return;
    setAction(send ? "send" : "preview");
    onBusy(true);
    const previous = new Map(reviews.map(row => [row.orderId, row]));
    try {
      const next: Review[] = [];
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
    } finally {
      onBusy(false);
      setAction(null);
    }
  }

  return <section aria-label="Bulk McLeod sync" className="booking-load-sync">
    <button type="button" className="booking-charge-button" disabled={disabled || Boolean(action)} onClick={() => void sync(false)}>
      {action === "preview" ? "Previewing…" : `Preview McLeod sync (${orderIds.length})`}
    </button>
    {!!sendable.length && <button type="button" className="booking-charge-button" disabled={disabled || Boolean(action)} onClick={() => void sync(true)}>
      {action === "send" ? "Sending…" : `Send reviewed differences (${sendable.length})`}
    </button>}
    {!!reviews.length && <ul aria-live="polite">{reviews.map(row => <li key={row.orderId}>
      <strong>{row.orderId}</strong>{" · "}
      {row.applied?.length ? `Verified ${row.applied.join(", ")}` : row.parts.length ? row.parts.join(", ") :
        row.issues.length ? "Review required" : "Already matches"}
      {!!row.issues.length && <small style={{ display: "block" }}>{row.issues.join(" · ")}</small>}
    </li>)}</ul>}
  </section>;
}
