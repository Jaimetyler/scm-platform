"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type OutsideCarrierRow = {
  id: string; updated_at: string; yard_status: "waiting" | "called" | "in_door" | "working" | "completed" | "cancelled" | null; draft_status: string;
  material_type?: string; movement_direction?: string | null;
  matched_order_id?: string | null; matched_stop_id?: string | null;
  mcleod_lookup_status?: string | null; mcleod_processing_phase?: string | null;
  mcleod_lookup_has_known_match?: boolean;
  mcleod_lookup_attempt_id?: string | null; mcleod_lookup_failure_code?: string | null;
  mcleod_lookup_failed_at?: string | null; processing_error?: string | null;
  outside_carrier_override_eligible?: boolean; lookup_retry_eligible?: boolean; lookup_prepare_eligible?: boolean;
  outside_carrier_override_at?: string | null; outside_carrier_override_reason?: string | null;
};

// Never derive permission from error text or the absence of an order alone.
export function canReviewOutsideCarrier(row: OutsideCarrierRow) {
  return row.outside_carrier_override_eligible === true &&
    row.material_type === "cotton" && row.movement_direction === "delivery" &&
    row.draft_status === "failed" && row.mcleod_lookup_status === "unresolved" &&
    row.mcleod_processing_phase === "lookup" && Boolean(row.mcleod_lookup_attempt_id) &&
    !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match &&
    ["waiting", "called", "in_door", "working"].includes(row.yard_status || "");
}

export function canRetryInterruptedLookup(row: OutsideCarrierRow) {
  return row.lookup_retry_eligible === true && row.material_type === "cotton" && row.movement_direction === "delivery" &&
    row.draft_status === "processing" && row.mcleod_processing_phase === "lookup" &&
    ["pending", "searching", "unresolved", "conflict", "error"].includes(row.mcleod_lookup_status || "") && Boolean(row.mcleod_lookup_attempt_id) &&
    !row.matched_order_id && !row.matched_stop_id &&
    ["waiting", "called", "in_door", "working"].includes(row.yard_status || "");
}

// A legacy failure is never manual-override permission. The server may attest
// that its original failure preceded all writes and permit a fresh lookup only.
export function canPrepareLegacyLookup(row: OutsideCarrierRow) {
  return row.lookup_prepare_eligible === true && row.mcleod_processing_phase === "legacy_review" &&
    row.draft_status === "failed" && row.material_type === "cotton" && row.movement_direction === "delivery" &&
    !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match && !row.outside_carrier_override_at &&
    ["waiting", "called", "in_door", "working"].includes(row.yard_status || "");
}

export function checkoutNeedsReview(row: OutsideCarrierRow) {
  return row.draft_status === "processing" ||
    ["write_pending", "legacy_processing", "legacy_review"].includes(row.mcleod_processing_phase || "");
}

export function OutsideCarrierMarker({ row }: { row: OutsideCarrierRow }) {
  if (row.mcleod_lookup_status !== "unresolved" || !row.outside_carrier_override_at) return null;
  return <span style={{ display: "block", color: "#fde68a", marginTop: 5 }}>
    Outside carrier · SCM verification unresolved · No McLeod update
  </span>;
}

export default function OutsideCarrierReview({ row, terminal, siteCode, canWrite, busy, onRetry,
  onBusy, onOpenChange, onComplete }: {
  row: OutsideCarrierRow; terminal: string; siteCode: string; canWrite: boolean; busy: boolean;
  onRetry: () => void; onBusy: (busy: boolean) => void; onOpenChange: (open: boolean) => void;
  onComplete: (row: OutsideCarrierRow, message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  const confirmation = useRef({ reason: "", acknowledged: false, open: false });
  const request = useRef<{ key: string; id: string } | null>(null);
  const attemptKey = `${terminal}:${siteCode}:${row.id}:${row.updated_at}:${row.mcleod_lookup_attempt_id}`;
  const latest = useRef({ row, canWrite, busy, attemptKey });
  latest.current = { row, canWrite, busy, attemptKey };
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setOpen(false); setReason(""); setAcknowledged(false); setError(""); setSubmitting(false);
    confirmation.current = { reason: "", acknowledged: false, open: false };
    request.current = null; inFlight.current = false;
    return () => {
      controller.abort();
      if (inFlight.current) onBusy(false);
      if (confirmation.current.open) onOpenChange(false);
      inFlight.current = false; confirmation.current.open = false;
    };
  }, [attemptKey]);

  async function submit() {
    const controller = lifecycle.current;
    const current = latest.current;
    const reason = confirmation.current.reason.trim();
    if (!controller || controller.signal.aborted || inFlight.current || current.busy || !current.canWrite ||
        current.attemptKey !== attemptKey || !canReviewOutsideCarrier(current.row) || current.row.updated_at !== row.updated_at ||
        current.row.id !== row.id || current.row.mcleod_lookup_attempt_id !== row.mcleod_lookup_attempt_id || !confirmation.current.open ||
        !confirmation.current.acknowledged || reason.length < 5 || reason.length > 500) return;
    // A response may be lost after the atomic commit. Reuse the same request ID
    // until the reason or persisted lookup attempt changes, including after Cancel.
    const key = `${attemptKey}:${reason}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    inFlight.current = true; setSubmitting(true); setError(""); onBusy(true);
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    controller.signal.addEventListener("abort", abortRequest, { once: true });
    const deadline = setTimeout(abortRequest, 20000);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: requestController.signal,
        body: JSON.stringify({ action: "process_outside_carrier", id: row.id, terminal, siteCode,
          expectedUpdatedAt: row.updated_at, lookupAttemptId: row.mcleod_lookup_attempt_id,
          acknowledgeUnresolved: true, reason, requestId: request.current.id }),
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save outside-carrier checkout. Retry or refresh the line to check its status.");
      if (!result.row || result.row.id !== row.id || result.row.yard_status !== "completed") {
        throw new Error("Checkout status could not be confirmed. Retry or refresh the line before taking another action.");
      }
      onOpenChange(false);
      onComplete(result.row, result.mcleod || "outside carrier; SCM verification unresolved; no McLeod update");
    } catch (error) {
      if (!controller.signal.aborted) setError(requestController.signal.aborted
        ? "The checkout response timed out. It may already have completed. Retry this confirmation or refresh the line to check its status."
        : error instanceof Error ? error.message : "Could not confirm checkout. Retry or refresh the line.");
    } finally {
      clearTimeout(deadline); controller.signal.removeEventListener("abort", abortRequest);
      if (!controller.signal.aborted) { inFlight.current = false; setSubmitting(false); onBusy(false); }
    }
  }

  if (!canReviewOutsideCarrier(row)) return null;
  return <section aria-label="Unresolved McLeod lookup" style={{ padding: 14, border: "1px solid #d97706", borderRadius: 7, color: "#fde68a" }}>
    <strong>McLeod search unresolved</strong>
    <p>SCM could not finish verifying this reference. Retry Search to try the normal delivery process again.</p>
    {!open ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" disabled={!canWrite || busy} style={button} onClick={() => {
        if (!latest.current.canWrite || latest.current.busy || inFlight.current || !canReviewOutsideCarrier(latest.current.row)) return;
        onRetry();
      }}>Retry Search</button>
      <button type="button" disabled={!canWrite || busy} style={button} onClick={() => {
        if (!latest.current.canWrite || latest.current.busy || inFlight.current || !canReviewOutsideCarrier(latest.current.row)) return;
        confirmation.current.open = true; setOpen(true); onOpenChange(true);
      }}>Process as Outside Carrier</button>
    </div> : <div role="group" aria-label="Confirm outside-carrier checkout">
      <p>This records the physical movement as completed and removes the truck from the active line. SCM verification remains unresolved. No McLeod update will be sent. Existing arrival details, cotton counts, paperwork, and notes are kept.</p>
      <label style={{ display: "grid", gap: 6 }}>Reason for outside-carrier checkout
        <textarea required minLength={5} maxLength={500} value={reason} disabled={submitting || !canWrite}
          onChange={(event) => { confirmation.current.reason = event.target.value; setReason(event.target.value); }} style={input} />
        <small>5–500 characters. Your reason will be saved with this checkout.</small>
      </label>
      <label style={{ display: "block", marginTop: 12 }}>
        <input type="checkbox" checked={acknowledged} disabled={submitting || !canWrite} onChange={(event) => {
          confirmation.current.acknowledged = event.target.checked; setAcknowledged(event.target.checked);
        }} /> I confirm the physical movement is complete and acknowledge that SCM verification remains unresolved and no McLeod update will be sent.
      </label>
      {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" disabled={!canWrite || busy || submitting || !acknowledged || reason.trim().length < 5 || reason.trim().length > 500}
          style={button} onClick={() => void submit()}>{submitting ? "Saving…" : "Confirm outside-carrier checkout"}</button>
        <button type="button" disabled={submitting} style={button} onClick={() => {
          if (inFlight.current) return;
          confirmation.current.open = false; confirmation.current.acknowledged = false;
          setOpen(false); setAcknowledged(false); setError(""); onOpenChange(false);
        }}>Cancel</button>
      </div>
    </div>}
  </section>;
}

const button = { background: "#1e293b", color: "#f8fafc", border: "1px solid #64748b", borderRadius: 6, padding: "8px 12px", cursor: "pointer" };
const input = { background: "#0f172a", color: "#f8fafc", border: "1px solid #64748b", borderRadius: 6, padding: 8, minHeight: 70, width: "100%", boxSizing: "border-box" as const };
