"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type OutsideCarrierRow = {
  terminal?: string; site_code?: string;
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
  onBusy, onOpenChange, onComplete, onReconcile }: {
  row: OutsideCarrierRow; terminal: string; siteCode: string; canWrite: boolean; busy: boolean;
  onRetry: () => void; onBusy: (busy: boolean) => void; onOpenChange: (open: boolean) => void;
  onComplete: (row: OutsideCarrierRow, message: string) => void;
  onReconcile: (row: OutsideCarrierRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [status, setStatus] = useState("");
  const refreshRequired = useRef(false);
  const inFlight = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  const confirmation = useRef({ open: false });
  const actionGeneration = useRef(0);
  const generation = actionGeneration.current;
  const request = useRef<{ key: string; id: string } | null>(null);
  const attemptKey = `${terminal}:${siteCode}:${row.id}:${row.updated_at}:${row.mcleod_lookup_attempt_id}`;
  const latest = useRef({ row, canWrite, busy, attemptKey });
  latest.current = { row, canWrite, busy, attemptKey };
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setOpen(false); setError(""); setSubmitting(false); setRefreshing(false); setNeedsRefresh(false); setStatus(""); refreshRequired.current = false;
    confirmation.current = { open: false };
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
    if (!controller || controller.signal.aborted || inFlight.current || refreshRequired.current || current.busy || !current.canWrite ||
        current.attemptKey !== attemptKey || !canReviewOutsideCarrier(current.row) || current.row.updated_at !== row.updated_at ||
        current.row.id !== row.id || current.row.mcleod_lookup_attempt_id !== row.mcleod_lookup_attempt_id || generation !== actionGeneration.current) return;
    // A response may be lost after the atomic commit. Reuse the same request ID
    // until the persisted row revision or lookup attempt changes, including after Cancel.
    const key = attemptKey;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    confirmation.current.open = true; setOpen(true); onOpenChange(true);
    inFlight.current = true; setSubmitting(true); setError(""); setStatus(""); onBusy(true);
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    controller.signal.addEventListener("abort", abortRequest, { once: true });
    const deadline = setTimeout(abortRequest, 20000);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: requestController.signal,
        body: JSON.stringify({ action: "process_outside_carrier", id: row.id, terminal, siteCode,
          expectedUpdatedAt: row.updated_at, lookupAttemptId: row.mcleod_lookup_attempt_id,
          acknowledgeUnresolved: true, requestId: request.current.id }),
      });
      if (controller.signal.aborted) return;
      if (response.status === 409) { refreshRequired.current = true; setNeedsRefresh(true); }
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

  async function refreshSavedStatus() {
    const controller = lifecycle.current;
    const current = latest.current;
    if (!controller || controller.signal.aborted || inFlight.current || current.busy || current.attemptKey !== attemptKey ||
        generation !== actionGeneration.current) return;
    inFlight.current = true; setRefreshing(true); setError(""); setStatus(""); onBusy(true);
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    controller.signal.addEventListener("abort", abortRequest, { once: true });
    const deadline = setTimeout(abortRequest, 20000);
    try {
      const query = new URLSearchParams({ id: row.id, terminal, siteCode });
      const response = await fetch(`/api/warehouse/domestic-queue?${query}`, { cache: "no-store", signal: requestController.signal });
      const result = await response.json();
      if (controller.signal.aborted || latest.current.attemptKey !== attemptKey || generation !== actionGeneration.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "Saved status could not be refreshed. No checkout action was taken.");
      const saved = result.row;
      // Never replace local evidence with an older, mismatched, or partial read.
      if (!saved || saved.id !== row.id || saved.terminal !== terminal || saved.site_code !== siteCode ||
          !Number.isFinite(Date.parse(saved.updated_at)) || Date.parse(saved.updated_at) < Date.parse(row.updated_at) ||
          !["waiting", "called", "in_door", "working", "completed", "cancelled"].includes(saved.yard_status) ||
          typeof saved.draft_status !== "string" || typeof saved.outside_carrier_override_eligible !== "boolean")
        throw new Error("Saved status could not be verified. Refresh again before taking another action.");
      refreshRequired.current = false; setNeedsRefresh(false);
      setStatus(saved.yard_status === "completed" ? "This movement is already completed. Saved status refreshed." : "Saved status refreshed. No checkout action was taken.");
      // This read never submits a checkout. Keep the request ID for an unchanged
      // revision/attempt, including an uncertain commit followed by Cancel.
      onReconcile(saved);
    } catch (error) {
      if (!controller.signal.aborted) setError(requestController.signal.aborted
        ? "Saved status refresh timed out. Checkout status remains uncertain. Try Refresh saved status again."
        : error instanceof Error ? error.message : "Saved status could not be refreshed.");
    } finally {
      clearTimeout(deadline); controller.signal.removeEventListener("abort", abortRequest);
      if (!controller.signal.aborted) { inFlight.current = false; setRefreshing(false); onBusy(false); }
    }
  }

  if (!canReviewOutsideCarrier(row)) return null;
  return <section aria-label="Unresolved McLeod lookup" style={{ padding: 14, border: "1px solid #d97706", borderRadius: 7, color: "#fde68a" }}>
    <strong>McLeod search unresolved</strong>
    <p>SCM could not finish verifying this reference. Retry Search to try the normal delivery process again.</p>
    <p>Process as Outside Carrier confirms the physical movement as completed and removes the truck from the active line. SCM verification remains unresolved. No McLeod update will be sent. Existing arrival details, cotton counts, paperwork, and notes are kept.</p>
    <p>Your confirmation and the unresolved search details are saved automatically.</p>
    {error && <p role="alert" style={{ color: "#fecaca" }}>{error} {needsRefresh ? "Refresh saved status before confirming again." : "Refresh saved status, or retry the same confirmation if its outcome is uncertain. Cancel before starting a new search."}</p>}
    {status && <p role="status">{status}</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" disabled={!canWrite || busy || submitting || open || needsRefresh} style={button} onClick={() => {
        if (!latest.current.canWrite || latest.current.busy || inFlight.current || refreshRequired.current || confirmation.current.open || !canReviewOutsideCarrier(latest.current.row) ||
            latest.current.attemptKey !== attemptKey || generation !== actionGeneration.current) return;
        onRetry();
      }}>Retry Search</button>
      <button type="button" disabled={!canWrite || busy || submitting || refreshing || needsRefresh} style={button}
        onClick={() => void submit()}>{submitting ? "Saving…" : "Process as Outside Carrier"}</button>
      {(open || needsRefresh) && <button type="button" disabled={busy || submitting || refreshing} style={button}
        onClick={() => void refreshSavedStatus()}>{refreshing ? "Refreshing…" : "Refresh saved status"}</button>}
      {open && <button type="button" disabled={submitting || refreshing} style={button} onClick={() => {
        if (inFlight.current) return;
        confirmation.current.open = false; actionGeneration.current++;
        setOpen(false); setError(""); onOpenChange(false);
      }}>Cancel</button>}
    </div>
  </section>;
}

const button = { background: "#1e293b", color: "#f8fafc", border: "1px solid #64748b", borderRadius: 6, padding: "8px 12px", cursor: "pointer" };
