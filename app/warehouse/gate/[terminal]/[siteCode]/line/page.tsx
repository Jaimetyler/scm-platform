"use client";
import { useVisiblePolling } from "@/components/warehouse/useVisiblePolling";
import PollingStatus from "@/components/warehouse/PollingStatus";
import { useCanWrite } from "@/components/auth/StaffSession";
import OutsideCarrierReview, { canReviewOutsideCarrier, canRetryInterruptedLookup, canPrepareLegacyLookup, checkoutNeedsReview, OutsideCarrierMarker, type OutsideCarrierRow } from "@/components/warehouse/OutsideCarrierReview";
import SourceLoadAlerts from "@/components/warehouse/SourceLoadAlerts";

import Link from "next/link";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import "@/components/warehouse/domestic-tables.css";
import ScmOrderBadge from "@/components/warehouse/ScmOrderBadge";
import PaperworkPhotoLink from "@/components/warehouse/PaperworkPhotoLink";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

import { mergePollingRows } from "@/lib/polling/merge-rows";
import { cottonShortage, type ShortageFields } from "@/lib/inbound/checkin/shortage";

type Status = "waiting" | "called" | "in_door" | "working";
type Arrival = ShortageFields & OutsideCarrierRow & {
  id: string; checked_in_at: string; driver_name: string | null; trucking_company: string | null; movement_direction: string | null;
  material_type: string; reference_number: string | null; mark: string | null;
  shipper: string | null; yard_status: Status | "completed" | "cancelled" | null;
  updated_at: string; matched_order_id: string | null; carrier_code?: string | null; scm_carrier?: boolean;
  draft_status: string; bol_bc: number | null; bale_count: number | null;
  warehouse_location: string | null; equipment_type: string | null;
  has_bol_photo: boolean; checkin_source: string | null;
};
type CottonFields = { mark: string; customer: string; bolBC: string; baleCount: string; warehouseLocation: string; equipmentType: string; shortageNote: string; acknowledgeShortage: boolean };
const LABEL: Record<Status, string> = {
  waiting: "Waiting", called: "Called", in_door: "In door", working: "Loading / Unloading",
};

export default function DomesticLinePage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const canWrite = useCanWrite(site?.terminal);
  const [rows, setRows] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const [outsideReviewId, setOutsideReviewId] = useState<string | null>(null);
  const [requestedArrival, setRequestedArrival] = useState<string | null>(null);
  const [invalidArrival, setInvalidArrival] = useState(false);
  const focusedArrival = useRef("");
  const operation = useRef<AbortController | null>(null);
  const workingRef = useRef("");
  const currentRows = useRef(rows); currentRows.current = rows;
  const currentCanWrite = useRef(canWrite); currentCanWrite.current = canWrite;
  const [cottonEditId, setCottonEditId] = useState<string | null>(null);
  const [cottonFields, setCottonFields] = useState<Record<string, CottonFields>>({});

  useLayoutEffect(() => {
    setRows([]); setLoading(true); setError(""); setNotice(""); setWorking("");
    setCottonEditId(null); setCottonFields({}); setOutsideReviewId(null); workingRef.current = "";
    const controller = new AbortController(); operation.current = controller;
    return () => controller.abort();
  }, [site?.terminal, site?.siteCode]);

  // The URL selects a display target only. Eligibility and all actions still
  // come from the freshly fetched, yard-scoped server row and explicit clicks.
  useLayoutEffect(() => {
    if (!window.location) return;
    const readArrival = () => {
      const values = new URLSearchParams(window.location.search).getAll("arrival");
      const value = values[0] ?? "";
      const valid = values.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
      setRequestedArrival(valid ? value.toLowerCase() : null);
      setInvalidArrival(values.length > 0 && !valid);
      focusedArrival.current = "";
    };
    readArrival();
    window.addEventListener("popstate", readArrival);
    return () => window.removeEventListener("popstate", readArrival);
  }, [site?.terminal, site?.siteCode]);

  useLayoutEffect(() => {
    if (loading || !requestedArrival || !site || focusedArrival.current === requestedArrival) return;
    if (!rows.some((row) => row.id === requestedArrival)) return;
    const target = document.getElementById(`arrival-${requestedArrival}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      focusedArrival.current = requestedArrival;
    }
  }, [loading, requestedArrival, rows, site]);

  const poll = useVisiblePolling({ intervalMs: 10000, enabled: !!site && !working && !cottonEditId && !outsideReviewId,
    requestKey: `${site?.terminal}:${site?.siteCode}`, load: async (signal) => {
      if (!site) return;
      const atRequestStart = currentRows.current;
      try {
        const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode, view: "line" });
        const response = await fetch(`/api/warehouse/domestic-queue?${query}`, { cache: "no-store", signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the domestic line");
        if (signal.aborted) return;
        if (workingRef.current) return;
        setRows((current) => mergePollingRows(current, result.rows, atRequestStart, new Set())); setError("");
      } catch (reason) {
        if (!signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the domestic line");
        throw reason;
      } finally { if (!signal.aborted) setLoading(false); }
    } });
  const load = poll.refresh;

  function openCotton(row: Arrival) {
    if (!currentCanWrite.current || workingRef.current || outsideReviewId || cottonEditId === row.id || checkoutNeedsReview(row)) return;
    setCottonFields((current) => ({ ...current, [row.id]: {
      shortageNote: "", acknowledgeShortage: false,
      mark: row.mark || "", customer: row.shipper || "", bolBC: String(row.bol_bc ?? ""),
      baleCount: String(row.bale_count ?? ""), warehouseLocation: row.warehouse_location || "",
      equipmentType: row.equipment_type || (site?.terminal === "SAV" ? "V" : ""),
    } }));
    setCottonEditId(row.id);
  }
  function changeCotton(id: string, field: keyof CottonFields, value: string | boolean) {
    if (!currentCanWrite.current || workingRef.current || outsideReviewId) return;
    setRows((current) => current.map((row) => row.id === id ? { ...row, outside_carrier_override_eligible: false } : row));
    setCottonFields((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  async function move(row: Arrival & { yard_status: Status }, to: "checkout" | "cancelled" | "retry_lookup", cotton?: CottonFields) {
    const controller = operation.current;
    const fresh = currentRows.current.find((item) => item.id === row.id);
    if (!site || !currentCanWrite.current || workingRef.current || outsideReviewId || !controller || controller.signal.aborted ||
        !fresh || fresh.updated_at !== row.updated_at || fresh.yard_status !== row.yard_status) return;
    if (to === "retry_lookup" ? !canRetryInterruptedLookup(fresh) :
        checkoutNeedsReview(fresh) && !(to === "checkout" && canPrepareLegacyLookup(fresh))) return;
    if (to === "cancelled" && !window.confirm(`Remove ${row.driver_name || row.reference_number || row.mark} from the line?`)) return;
    setNotice(""); setError("");
    workingRef.current = row.id; setWorking(row.id);
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, outside_carrier_override_eligible: false, lookup_retry_eligible: false } : item));
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    controller.signal.addEventListener("abort", abortRequest, { once: true });
    const deadline = setTimeout(abortRequest, 30000);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: requestController.signal,
        body: JSON.stringify({ id: row.id, from: row.yard_status, to, action: to === "cancelled" ? undefined : to,
          expectedUpdatedAt: row.updated_at, cotton: to === "retry_lookup" ? undefined : cotton,
          terminal: site.terminal, siteCode: site.siteCode }),
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (result.row?.id === row.id) {
        const explicitLookupFailure = result.code === "MCLEOD_LOOKUP_UNRESOLVED" && result.outsideCarrierEligible === true;
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, ...result.row,
          outside_carrier_override_eligible: explicitLookupFailure && result.row.outside_carrier_override_eligible === true } : item));
      } else if (!response.ok || !result.ok) {
        // A generic or uncertain failure must never leave an older override available.
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, outside_carrier_override_eligible: false } : item));
      }
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not update this arrival");
      setCottonEditId(null);
      setNotice(to === "cancelled" ? "Arrival removed" : `Checked out · ${result.mcleod}`);
    } catch (reason) {
      if (!controller.signal.aborted) setError(requestController.signal.aborted
        ? "The checkout response timed out. Its status is uncertain. Close the cotton form and refresh the line before trying again."
        : reason instanceof Error ? reason.message : "Could not update this arrival");
    } finally {
      clearTimeout(deadline); controller.signal.removeEventListener("abort", abortRequest);
      if (!controller.signal.aborted) { workingRef.current = ""; setWorking(""); }
    }
  }

  function retrySearch(row: Arrival & { yard_status: Status }) {
    if (cottonFields[row.id]) void move(row, "checkout", cottonFields[row.id]);
    else {
      // GET eligibility can restore the saved failure after navigation. Reuse the
      // persisted receiving fields without replacing driver details or paperwork.
      void move(row, "checkout", { mark: row.mark || "", customer: row.shipper || "",
        bolBC: String(row.bol_bc ?? ""), baleCount: String(row.bale_count ?? ""),
        warehouseLocation: row.warehouse_location || "", equipmentType: row.equipment_type || "",
        shortageNote: "", acknowledgeShortage: false });
    }
  }

  if (!site) return <main><PlatformPageHeader title="Domestic Line Not Found" /></main>;
  const active = rows.filter((row): row is Arrival & { yard_status: Status } =>
    row.yard_status === "waiting" || row.yard_status === "called" || row.yard_status === "in_door" || row.yard_status === "working")
    .sort((a, b) => new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime() || a.id.localeCompare(b.id));
  const unresolvedCompleted = rows.filter((row) => row.yard_status === "completed" && row.outside_carrier_override_at && row.mcleod_lookup_status === "unresolved");
  const selectedArrival = rows.find((row) => row.id === requestedArrival);
  const selectedInactive = selectedArrival && !active.some((row) => row.id === selectedArrival.id);
  const waiting = active.filter((row) => row.yard_status === "waiting").length;
  const nextWaitingId = active.find((row) => row.yard_status === "waiting")?.id;
  const time = (value: string) => new Date(value).toLocaleTimeString("en-US", {
    timeZone: site.terminal === "HOU" ? "America/Chicago" : "America/New_York", hour: "numeric", minute: "2-digit",
  });
  return <main style={{ width: "100%", padding: "0 12px", boxSizing: "border-box" }}>
    <PlatformPageHeader title={`${site.siteName} Domestic Line`}
      subtitle="Cotton, lumber, and other freight in arrival order. Check out when a truck leaves the yard." />
    {(requestedArrival || invalidArrival) && <PlatformPanel>
      <Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={{ color: "#67e8f9" }}>Back to receiving</Link>
      <p>If receiving is still open, return to that tab to keep your edits. Finish saving there, then refresh this line before reviewing checkout.</p>
      {invalidArrival ? <p role="alert">Invalid arrival link. Select an arrival from this yard below.</p> : loading ? <p>Finding the saved arrival…</p> :
        !selectedArrival ? <p role="alert">This arrival is not in this yard’s current line results. Check the yard and refresh; no checkout action was taken.</p> :
        selectedInactive ? <div id={`arrival-${selectedArrival.id}`} tabIndex={-1} role="status" style={{ border: "2px solid #d97706", padding: 12 }}>
          <strong>{selectedArrival.reference_number || selectedArrival.mark || "Arrival"} · {selectedArrival.driver_name || "Staff entry"}</strong>
          <p>This arrival is {selectedArrival.yard_status || "not active"}. It cannot be checked out again from this link.</p>
          <OutsideCarrierMarker row={selectedArrival} />
          {selectedArrival.outside_carrier_override_reason && <p>Reason: {selectedArrival.outside_carrier_override_reason}</p>}
        </div> : <p role="status">The requested arrival is highlighted below. Review its current status; this link does not establish outside-carrier eligibility.</p>}
    </PlatformPanel>}
    {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
    {notice && <p role="status" style={{ color: "#86efac" }}>{notice}</p>}
      <SourceLoadAlerts terminal={site.terminal} siteCode={site.siteCode} />
    <PlatformPanel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <strong>{waiting} waiting · {active.length} active</strong>
        <PollingStatus {...poll} /><button disabled={!!working || !!cottonEditId || !!outsideReviewId} style={button} onClick={() => void load()}>Refresh</button>
      </div>
      {loading ? <p>Loading arrivals…</p> : active.length === 0 ? <p>No active domestic arrivals.</p> :
        <div style={{ overflowX: "auto" }}><table className="domestic-table" style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", color: "#e2e8f0" }}>
          <thead><tr>{["#", "Arrived", "Freight", "Move", "Driver", "Trucking company", "Reference / mark", "Customer", "SCM / order", "Yard status", "Action"].map((name) =>
            <th key={name} style={heading}>{name}</th>)}</tr></thead>
          <tbody>{active.map((row, index) => <Fragment key={row.id}><tr id={`arrival-${row.id}`} tabIndex={row.id === requestedArrival ? -1 : undefined}
            aria-label={row.id === requestedArrival ? "Requested arrival" : undefined}
            style={{ outline: row.id === requestedArrival ? "2px solid #fbbf24" : undefined,
              background: row.id === requestedArrival ? "rgba(251,191,36,.12)" : row.id === nextWaitingId ? "rgba(34,211,238,.12)" : undefined }}>
            <td style={cell}>{index + 1}{row.matched_order_id && <div style={{ marginTop: 3 }}><ScmOrderBadge orderId={row.matched_order_id} /></div>}
              {row.has_bol_photo && <div style={{ marginTop: 4 }}><PaperworkPhotoLink checkinId={row.id} compact /></div>}</td>
            <td style={cell}>{time(row.checked_in_at)}</td>
            <td style={cell}>{row.material_type === "cotton" ? "Cotton" : row.material_type === "lumber" ? "Lumber" : "Other"}</td>
            <td style={cell}>{row.movement_direction || "—"}</td>
            <td style={cell}>{row.driver_name || "Staff entry"}
              {row.checkin_source === "driver_qr" && <Link href={`/warehouse/checkin/${row.id}`} style={{ display: "block", marginTop: 4, color: "#67e8f9", fontSize: 11 }}>Driver details</Link>}</td>
            <td style={cell}>{row.trucking_company || "Company not entered"}</td>
            <td style={cell}>{row.reference_number || row.mark || "—"}</td>
            <td style={cell}>{row.shipper || "—"}</td>
            <td style={cell}>{row.scm_carrier && <strong style={{ color: "#86efac", display: "block" }}>SCM carrier</strong>}
              {row.matched_order_id ? <span>McLeod #{row.matched_order_id}</span> : "—"}
              {row.carrier_code && <small style={{ display: "block", color: "#94a3b8" }}>Carrier {row.carrier_code}</small>}</td>
            <td style={cell}>{LABEL[row.yard_status]}{checkoutNeedsReview(row) && !canRetryInterruptedLookup(row) && !canPrepareLegacyLookup(row) && <div style={{ color: "#fde68a", marginTop: 5 }}>McLeod status needs review. This arrival stays active until any pending update is reconciled.</div>}{canPrepareLegacyLookup(row) && <div style={{ color: "#fde68a", marginTop: 5 }}>This earlier lookup failed before any McLeod update. Retry Search must verify the saved receiving details again.</div>}{canRetryInterruptedLookup(row) && <div style={{ color: "#fde68a", marginTop: 5 }}>Lookup has not finished. Retry Search uses the saved receiving details.</div>}<OutsideCarrierMarker row={row} />{cottonShortage(row) && <div style={{ color: "#fde68a", marginTop: 5 }}>{cottonShortage(row)!.missing} bales short · McLeod delivery blocked{!row.customer_notified_at && " · Notify customer"}</div>}{row.id === nextWaitingId ? <div style={{ color: "#67e8f9", fontSize: 12 }}>Next in line</div> : null}</td>
            <td style={cell}><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {canRetryInterruptedLookup(row) ? <button disabled={!canWrite || Boolean(working) || Boolean(outsideReviewId)} style={primary}
                onClick={() => void move(row, "retry_lookup")}>Retry Search</button> : canPrepareLegacyLookup(row) ? <button disabled={!canWrite || Boolean(working) || Boolean(outsideReviewId)} style={primary}
                onClick={() => retrySearch(row)}>Retry Search</button> : <button disabled={!canWrite || Boolean(working) || Boolean(outsideReviewId) || checkoutNeedsReview(row)} style={primary} onClick={() => row.material_type === "cotton" && row.movement_direction === "delivery" && !["processed", "outside_carrier", "delivery_blocked"].includes(row.draft_status)
                ? openCotton(row) : void move(row, "checkout")}>{working === row.id ? "Checking out…" : row.material_type === "cotton" && row.movement_direction === "delivery" && !["processed", "outside_carrier", "delivery_blocked"].includes(row.draft_status) ? "Finish cotton" : "Check out"}</button>}
              <button disabled={!canWrite || Boolean(working) || Boolean(outsideReviewId) || checkoutNeedsReview(row)} style={button} onClick={() => void move(row, "cancelled")}>Remove</button>
            </div></td>
          </tr>{cottonEditId === row.id && cottonFields[row.id] && <tr><td colSpan={11} style={{ ...cell, background: "#132337" }}>
            <form onSubmit={(event) => { event.preventDefault(); void move(row, "checkout", cottonFields[row.id]); }}>
              <strong>Finish cotton delivery · McLeod {row.matched_order_id ? `#${row.matched_order_id}` : "order search at completion"}</strong>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                {([ ["Mark", "mark"], ["Customer", "customer"], ["BOL bale count", "bolBC"],
                  ["Bales unloaded", "baleCount"], ["Warehouse location", "warehouseLocation"] ] as [string, Exclude<keyof CottonFields, "acknowledgeShortage">][]).map(([label, field]) =>
                  <label key={field} style={{ display: "grid", gap: 5, fontSize: 12 }}>{label}
                    <input disabled={!!working || !!outsideReviewId || !canWrite || checkoutNeedsReview(row)} required inputMode={field === "bolBC" || field === "baleCount" ? "numeric" : "text"}
                      value={cottonFields[row.id][field]} onChange={(event) => changeCotton(row.id, field, event.target.value)} style={input} />
                  </label>)}
                <label style={{ display: "grid", gap: 5, fontSize: 12 }}>Equipment
                  <select disabled={!!working || !!outsideReviewId || !canWrite || checkoutNeedsReview(row)} required value={cottonFields[row.id].equipmentType} onChange={(event) => changeCotton(row.id, "equipmentType", event.target.value)} style={input}>
                    <option value="">Select</option><option value="V">Van</option><option value="F">Flatbed</option>
                  </select></label>
              </div>
              {cottonShortage({ ...row, bol_bc: Number(cottonFields[row.id].bolBC) || null, bale_count: cottonFields[row.id].baleCount === "" ? null : Number(cottonFields[row.id].baleCount) }) && <div role="alert" style={{ padding: 14, marginTop: 12, border: "1px solid #d97706", borderRadius: 7, color: "#fde68a" }}>
                <strong>Bale shortage · McLeod delivery cannot be posted</strong>
                <p>Receiving can finish after acknowledgement. Notify the customer and record follow-up in Notes.</p>
                <label style={{ display: "block", marginBottom: 8 }}><input disabled={!!working || !!outsideReviewId || !canWrite || checkoutNeedsReview(row)} type="checkbox" checked={cottonFields[row.id].acknowledgeShortage} onChange={(event) => changeCotton(row.id, "acknowledgeShortage", event.target.checked)} /> I acknowledge the bale shortage</label>
                <label style={{ display: "grid", gap: 5 }}>Shortage note<textarea disabled={!!working || !!outsideReviewId || !canWrite || checkoutNeedsReview(row)} value={cottonFields[row.id].shortageNote} maxLength={2000} onChange={(event) => changeCotton(row.id, "shortageNote", event.target.value)} style={input} /></label>
              </div>}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={!canWrite || Boolean(working) || Boolean(outsideReviewId) || checkoutNeedsReview(row)} style={primary}>{working === row.id ? "Finishing…" : cottonShortage({ ...row, bol_bc: Number(cottonFields[row.id].bolBC) || null, bale_count: cottonFields[row.id].baleCount === "" ? null : Number(cottonFields[row.id].baleCount) }) ? "Finish receiving & check out" : "Process delivery & check out"}</button>
                <button type="button" disabled={!canWrite || Boolean(working) || Boolean(outsideReviewId)} style={button} onClick={() => {
                  if (workingRef.current) return;
                  setCottonEditId(null);
                  setCottonFields((current) => { const next = { ...current }; delete next[row.id]; return next; });
                }}>Cancel</button>
              </div>
            </form>
          </td></tr>}{canReviewOutsideCarrier(row) && <tr><td colSpan={11} style={cell}>
            <OutsideCarrierReview key={`${row.id}:${row.updated_at}:${row.mcleod_lookup_attempt_id}`}
              row={row} terminal={site.terminal} siteCode={site.siteCode} canWrite={canWrite} busy={!!working}
              onRetry={() => retrySearch(row)} onOpenChange={(open) => setOutsideReviewId(open ? row.id : null)}
              onBusy={(busy) => { workingRef.current = busy ? row.id : ""; setWorking(busy ? row.id : ""); }}
              onComplete={(completed, message) => {
                setRows((current) => current.map((item) => item.id === row.id ? { ...item, ...completed } : item));
                workingRef.current = ""; setWorking(""); setCottonEditId(null); setOutsideReviewId(null); setError("");
                setNotice(`Checked out · ${message}`);
              }} />
          </td></tr>}</Fragment>)}</tbody>
        </table></div>}
    </PlatformPanel>
    {unresolvedCompleted.length > 0 && <PlatformPanel>
      <strong>Completed movements · SCM verification unresolved</strong>
      <ul>{unresolvedCompleted.map((row) => <li key={row.id} style={{ marginTop: 10 }}>
        <Link href={`/warehouse/checkin/${row.id}`} style={{ color: "#67e8f9" }}>{row.reference_number || row.mark || "Arrival"} · {row.driver_name || "Staff entry"}</Link>
        <OutsideCarrierMarker row={row} />
        {row.outside_carrier_override_reason && <span style={{ display: "block" }}>Reason: {row.outside_carrier_override_reason}</span>}
      </li>)}</ul>
    </PlatformPanel>}
  </main>;
}

const button: React.CSSProperties = { padding: "8px 11px", border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", borderRadius: 7, textDecoration: "none", cursor: "pointer" };
const primary: React.CSSProperties = { ...button, background: "#0e7490", borderColor: "#0e7490", color: "#fff" };
const heading: React.CSSProperties = { padding: "10px 8px", textAlign: "left", borderBottom: "2px solid #475569", whiteSpace: "nowrap" };
const cell: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #334155", verticalAlign: "top" };
const input: React.CSSProperties = { padding: "8px", borderRadius: 6, border: "1px solid #475569", background: "#0b1220", color: "white", minWidth: 130 };
