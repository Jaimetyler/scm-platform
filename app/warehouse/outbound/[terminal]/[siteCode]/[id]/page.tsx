"use client";
import Link from "next/link";
import { useWarehouseViewState } from "@/components/warehouse/useWarehouseViewState";
import { safeOutboundReturn } from "@/lib/warehouse/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import CutoffInput from "@/components/warehouse/CutoffInput";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { bookingDateInput, formatBookingDate } from "@/lib/warehouse/outbound/details";

import { containerInfoRows, containerInfoText, containerInfoHtml } from "@/lib/warehouse/outbound/container-info-rows";
import "./booking.css";
import { bookingMarkBadges } from "@/lib/warehouse/outbound/marks";
import { bookingBaleDisplay } from "@/lib/warehouse/outbound/bale-display";

type Container = { id: string; sequence_no: number; booking_line_id: string | null; container_number: string | null; seal_number: string | null;
  chassis_number: string | null; notes: string | null; updated_at: string; split_transfer_id: string | null;
  split: { mark: string; bales: number; target_booking_id: string; target_booking_number: string } | null };
type Line = { id: string; source_row: number; mark: string; requested_bales: number; mark_requested_total: number; available_bales: number; warehouse_bales: number;
  line_status: "active" | "on_hold" | "cancelled"; load_source: "warehouse" | "source_load"; status_note: string | null; source_warehouse: string;
  source_arrivals: { arrival_site_name: string; checkin_id: string | null }[]; load_by: string | null; shipping_order: string | null; inventory_locations: string[]; inbound_bales: number; inbound_statuses: string[] };
type Booking = { scm_file_number?: string | null; id: string; booking_number: string; customer: string; customer_reference: string | null;
  requested_bales: number; planned_containers: number | null; site_name: string; status: string; doc_cutoff_has_time: boolean; cutoff_has_time: boolean; erd: string | null; doc_cutoff: string | null; cutoff: string | null; vessel: string | null; updated_at: string };
type Draft = { bookingLineId: string; containerNumber: string; sealNumber: string; chassisNumber: string; notes: string };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
const button: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #475569",
  background: "#0f172a", color: "#f8fafc", cursor: "pointer", fontWeight: 700, textDecoration: "none" };
const th: React.CSSProperties = { padding: "10px", borderBottom: "1px solid #475569", color: "#94a3b8", fontSize: 12, textAlign: "left" };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: "1px solid rgba(71,85,105,.45)" };

export default function CottonOutboundBookingPage() {
  const queryParams = useSearchParams();
  const params = useParams<{ terminal: string; siteCode: string; id: string }>();
  const terminal = String(params.terminal ?? "").toUpperCase();
  const siteCode = String(params.siteCode ?? "");
  const id = String(params.id ?? "");
  const requestedReturn = queryParams.get("returnTo");
  const backHref = safeOutboundReturn(requestedReturn) ?? `/warehouse/outbound?terminal=${terminal}&siteCode=${siteCode}`;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useWarehouseViewState("search", "");
  const [rollMode, setRollMode] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [rollBooking, setRollBooking] = useState("");
  const [rollQuantities, setRollQuantities] = useState<Record<string, string>>({});
  const [newMark, setNewMark] = useState<{ requestId: string; mark: string; bales: string; shippingOrder: string } | null>(null);
  const [markError, setMarkError] = useState("");
  const [markAction, setMarkAction] = useState<{ line: Line; action: "hold" | "resume" | "cancel" | "warehouse" | "keep_source"; note: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState({ scmFileNumber: "", erd: "", docCutoff: "", cutoff: "", vessel: "" });
  const [importedDateNotes, setImportedDateNotes] = useState<string[]>([]);
  const requestInput = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Record<string, number>>({});

  const load = useCallback(async (preserve?: { containers: Record<string, Container>; drafts: Record<string, Draft> }) => {
    try {
      const query = new URLSearchParams({ terminal, siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooking(result.booking); setContainers((result.containers as Container[]).map((row) => preserve?.containers[row.id] ?? row)); setLines(result.lines); setSelectedLines(new Set());
      setDrafts(Object.fromEntries((result.containers as Container[]).map((row) => [row.id, {
        bookingLineId: row.booking_line_id ?? "", containerNumber: row.container_number ?? "", sealNumber: row.seal_number ?? "",
        chassisNumber: row.chassis_number ?? "", notes: row.notes ?? "",
        ...preserve?.drafts[row.id],
      }])));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load booking"); }
    finally { setLoading(false); }
  }, [id, terminal, siteCode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { Object.values(saveTimers.current).forEach((timer) => window.clearTimeout(timer)); }, []);

  function change(row: Container, field: keyof Draft, value: string) {
    if (row.split_transfer_id || lines.find((line) => line.id === row.booking_line_id)?.line_status !== "active" && row.booking_line_id) return;
    const nextValue = field === "notes" || field === "bookingLineId" ? value : value.toUpperCase();
    const next = { ...drafts[row.id], [field]: nextValue };
    setDrafts((current) => ({ ...current, [row.id]: next }));
    setMessage("");
    if (saveTimers.current[row.id]) window.clearTimeout(saveTimers.current[row.id]);
    const wasComplete = Boolean(row.container_number && row.seal_number);
    const isComplete = Boolean(next.containerNumber.trim() && next.sealNumber.trim());
    if (wasComplete || isComplete) saveTimers.current[row.id] = window.setTimeout(() => void save(row, next), 700);
  }
  async function save(row: Container, draftToSave: Draft) {
    if (row.split_transfer_id || lines.find((line) => line.id === row.booking_line_id)?.line_status !== "active" && row.booking_line_id) return;
    setWorking(row.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/containers`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, containerId: row.id, expectedUpdatedAt: row.updated_at, ...draftToSave }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setContainers((current) => current.map((item) => item.id === row.id ? result.container : item));
      setMessage(`Container ${row.sequence_no} saved.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save container"); }
    finally { setWorking(""); }
  }
  function pendingEquipment() {
    const dirty = containers.filter((row) => {
      const draft = drafts[row.id];
      return draft && (draft.bookingLineId !== (row.booking_line_id ?? "") || draft.containerNumber !== (row.container_number ?? "") ||
        draft.sealNumber !== (row.seal_number ?? "") || draft.chassisNumber !== (row.chassis_number ?? "") || draft.notes !== (row.notes ?? ""));
    });
    return { containers: Object.fromEntries(dirty.map((row) => [row.id, row])), drafts: Object.fromEntries(dirty.map((row) => [row.id, drafts[row.id]])) };
  }
  async function addMark(event: React.FormEvent) {
    event.preventDefault();
    if (!newMark || !booking || working) return;
    setWorking("add-mark"); setMarkError(""); setMessage("");
    const preserve = pendingEquipment();
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/lines`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking.updated_at, ...newMark, bales: Number(newMark.bales) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not add mark");
      setNewMark(null); setSearch("");
      await load(preserve);
      setMessage(`${newMark.mark.trim().toUpperCase()} added to booking with ${newMark.bales} requested bales.`);
    } catch (reason) { setMarkError(reason instanceof Error ? reason.message : "Could not add mark"); }
    finally { setWorking(""); }
  }

  function chooseMarkAction(line: Line, action: "hold" | "resume" | "cancel" | "warehouse" | "keep_source") {
    setActionError(""); setMarkAction({ line, action, note: "" });
  }
  async function changeMark(event: React.FormEvent) {
    event.preventDefault();
    if (!markAction || !booking || working) return;
    const preserve = pendingEquipment();
    if (containers.some((row) => row.booking_line_id === markAction.line.id && preserve.drafts[row.id])) {
      setActionError("Finish or clear this mark’s unsaved equipment details before changing its plan."); return;
    }
    setWorking("mark-action"); setActionError("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/lines/${markAction.line.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking.updated_at, action: markAction.action, note: markAction.note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load(preserve); setMarkAction(null); setRollMode(false);
      setMessage(`${markAction.line.mark}: ${markAction.action === "hold" ? "placed on hold" : markAction.action === "resume" ? "resumed" : markAction.action === "cancel" ? "cancelled from this booking" : markAction.action === "warehouse" ? "converted to warehouse load" : "arrival reviewed; remains a source load"}.`);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not change mark"); }
    finally { setWorking(""); }
  }

  function toggleLine(line: Line) {
    setSelectedLines((current) => {
      const next = new Set(current);
      if (next.has(line.id)) next.delete(line.id); else next.add(line.id);
      return next;
    });
    setRollQuantities((current) => ({ ...current, [line.id]: current[line.id] || String(line.requested_bales) }));
  }
  async function rollSelected() {
    const moves = [...selectedLines].map((lineId) => ({ lineId, bales: Number(rollQuantities[lineId]) }));
    const preserve = pendingEquipment();
    setWorking("bulk-roll"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/rollover`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, targetBookingNumber: rollBooking, moves }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setRollBooking(""); setRollQuantities({}); setSelectedLines(new Set()); setRollMode(false);
      setMessage(`${moves.length} mark${moves.length === 1 ? "" : "s"} moved to booking ${result.targetBookingNumber}.`);
      await load(preserve);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not roll selected marks"); }
    finally { setWorking(""); }
  }

  async function copyContainerInfo() {
    if (!booking) return;
    setError(""); setMessage("");
    if (working || Object.keys(pendingEquipment().drafts).length) {
      setError("Finish saving equipment details before copying container information."); return;
    }
    try {
      const rows = containerInfoRows(lines, containers);
      const text = containerInfoText(booking, rows);
      if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([containerInfoHtml(booking, rows)], { type: "text/html" }) })]);
      } else await navigator.clipboard.writeText(text);
      setMessage("Container information copied. Paste it into your email or spreadsheet.");
    } catch { setError("Clipboard access failed. Try again or use Export Container Info."); }
  }

  function editDetails() {
    if (!booking) return;
    setDetails({ scmFileNumber: booking.scm_file_number ?? "", erd: bookingDateInput(booking.erd), docCutoff: bookingDateInput(booking.doc_cutoff, booking.doc_cutoff_has_time !== false),
      cutoff: bookingDateInput(booking.cutoff, booking.cutoff_has_time !== false), vessel: booking.vessel ?? "" });
    setEditingDetails(true);
    setImportedDateNotes([]);
  }
  async function importDetails(file: File) {
    if (!booking) return;
    setWorking("import-details"); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.set("file", file); body.set("terminal", terminal); body.set("siteCode", siteCode);
      const response = await fetch("/api/warehouse/outbound/preview", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.booking.bookingNumber !== booking.booking_number) throw new Error(`This file belongs to booking ${result.booking.bookingNumber}, not ${booking.booking_number}.`);
      const source = result.booking;
      if (!source.erd && !source.docCutoff && !source.cutoff && !source.vessel && !source.detailNotes?.length) throw new Error("No sailing details were found in this request.");
      setDetails({ scmFileNumber: booking.scm_file_number ?? "", erd: source.erd ?? bookingDateInput(booking.erd),
        docCutoff: source.docCutoff ?? bookingDateInput(booking.doc_cutoff, booking.doc_cutoff_has_time !== false),
        cutoff: source.cutoff ?? bookingDateInput(booking.cutoff, booking.cutoff_has_time !== false), vessel: source.vessel ?? booking.vessel ?? "" });
      setImportedDateNotes([...(source.sourceDates ?? []).map(({ label, value }: { label: string; value: string }) => `${label}: ${formatBookingDate(value, value.includes("T"))}`), ...(source.detailNotes ?? [])]);
      setEditingDetails(true); setMessage("Review the imported booking details, then save.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import booking details"); }
    finally { setWorking(""); if (requestInput.current) requestInput.current.value = ""; }
  }
  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    setWorking("details"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking?.updated_at, ...details }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooking(result.booking); setEditingDetails(false); setMessage("Booking details updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update booking details"); }
    finally { setWorking(""); }
  }

  if (loading) return <main style={{ color: "#e2e8f0" }}>Loading booking…</main>;
  if (!booking) return <main><PlatformPageHeader title="Outbound Booking Not Found" actions={<Link href={backHref} style={button}>Back</Link>} />{error && <p style={{ color: "#fca5a5" }}>{error}</p>}</main>;
  const activeContainers = containers.filter((row) => !row.split_transfer_id && (!row.booking_line_id || lines.find((line) => line.id === row.booking_line_id)?.line_status === "active"));
  const complete = activeContainers.filter((row) => row.container_number && row.seal_number && row.chassis_number).length;
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const term = search.trim().toUpperCase();
  const visibleContainers = containers.filter((row) => {
    const assigned = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
    return !term || [row.sequence_no, row.container_number, row.seal_number, row.chassis_number, row.notes,
      assigned?.mark, assigned?.shipping_order, row.split?.mark, row.split?.target_booking_number].some((value) => String(value ?? "").toUpperCase().includes(term));
  }).sort((a, b) => {
    const rank = (row: Container) => {
      const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
      return row.split_transfer_id ? 4 : line?.line_status === "cancelled" ? 3 : line?.line_status === "on_hold" ? 2 : line?.load_source === "source_load" ? 1 : 0;
    };
    return rank(a) - rank(b) || a.sequence_no - b.sequence_no;
  });
  return <main className="outbound-booking" style={{ maxWidth: 1550, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title={booking.scm_file_number ? `SCM File # ${booking.scm_file_number}` : `Booking ${booking.booking_number}`}
      subtitle={`${booking.customer} · ${booking.scm_file_number ? `Booking ${booking.booking_number} · ` : ""}${booking.site_name}`}
      actions={<><Link href={backHref} style={button}>← Booking list</Link>
        <details className="booking-actions"><summary style={button}>Actions ▾</summary><div className="booking-actions-menu">
          <Link href={`/warehouse/outbound/${terminal}/${siteCode}/${id}/print`} target="_blank">Print File</Link>
          <a href={`/api/warehouse/outbound/bookings/${id}/export?terminal=${terminal}&siteCode=${siteCode}`}>Export Booking</a>
          <a href={`/api/warehouse/outbound/bookings/${id}/container-info?terminal=${terminal}&siteCode=${siteCode}`}>Export Container Info</a>
          <button type="button" disabled={Boolean(working)} onClick={() => void copyContainerInfo()}>Copy Container Info</button>
          <button type="button" disabled={Boolean(working) || editingDetails} onClick={editDetails}>Edit booking details</button>
          <button type="button" disabled={Boolean(working) || editingDetails} onClick={() => requestInput.current?.click()}>Import sailing details</button>
        </div></details></>} />
    <PlatformPanel><div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <strong>{booking.requested_bales} requested bales</strong><span>{booking.planned_containers ?? "—"} planned containers</span>
      <span>{complete} of {activeContainers.length} equipment rows complete</span><span>Customer ref {booking.customer_reference || "—"}</span><strong style={{ color: lines.some((line) => line.line_status === "active" && line.load_source === "warehouse" && line.warehouse_bales < line.mark_requested_total) ? "#fca5a5" : "#86efac" }}>{new Set(lines.filter((line) => line.line_status === "active" && line.load_source === "warehouse" && line.warehouse_bales < line.mark_requested_total).map((line) => line.mark)).size} missing marks</strong><span className="booking-status">{booking.status.replaceAll("_", " ")}</span>
    </div>
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
      <span><strong>ERD</strong> {formatBookingDate(booking.erd)}</span>
      <span><strong>Doc cutoff</strong> {formatBookingDate(booking.doc_cutoff, booking.doc_cutoff_has_time !== false)}</span>
      <span><strong>Cutoff</strong> {formatBookingDate(booking.cutoff, booking.cutoff_has_time !== false)}</span>
      {booking.vessel ? <span><strong>Vessel</strong> {booking.vessel}</span> : null}
    </div>
    <input ref={requestInput} type="file" accept=".xlsx" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDetails(file); }} />
    {editingDetails ? <form onSubmit={(event) => void saveDetails(event)} style={{ marginTop: 16 }}>
      {importedDateNotes.length ? <p style={{ color: "#fbbf24", fontSize: 12 }}>{importedDateNotes.join(" · ")}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <label>SCM File #<input style={input} maxLength={80} value={details.scmFileNumber} onChange={(event) => setDetails((current) => ({ ...current, scmFileNumber: event.target.value }))} /></label>
        <label>ERD<input type="date" style={input} value={details.erd} onChange={(event) => setDetails((current) => ({ ...current, erd: event.target.value }))} /></label>
        <CutoffInput label="Doc cutoff" value={details.docCutoff} onChange={(value) => setDetails((current) => ({ ...current, docCutoff: value }))} />
        <CutoffInput label="Cutoff" value={details.cutoff} onChange={(value) => setDetails((current) => ({ ...current, cutoff: value }))} />
        <label>Vessel<input style={input} maxLength={200} value={details.vessel} onChange={(event) => setDetails((current) => ({ ...current, vessel: event.target.value }))} /></label>
      </div><p style={{ color: "#94a3b8", fontSize: 12 }}>Times are optional and local to {booking.site_name}.</p>
      <div style={{ display: "flex", gap: 8 }}><button style={button} type="submit" disabled={Boolean(working)}>{working === "details" ? "Saving…" : "Save details"}</button>
        <button style={button} type="button" disabled={Boolean(working)} onClick={() => { setEditingDetails(false); setMessage(""); }}>Cancel</button></div>
    </form> : null}
    {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}</PlatformPanel>

    {lines.some((line) => line.source_arrivals?.length && line.line_status !== "cancelled") && <PlatformPanel><div role="alert" style={{ color: "#fde68a" }}>
      <strong>Source loads arrived at a warehouse — review required</strong>
      {lines.filter((line) => line.source_arrivals?.length && line.line_status !== "cancelled").map((line) => <p key={line.id}>{line.mark} · {line.source_arrivals.map((arrival) => arrival.arrival_site_name).join(", ")} · <button type="button" style={button} disabled={Boolean(working)} onClick={() => chooseMarkAction(line, "warehouse")}>Convert to warehouse load</button> <button type="button" style={button} disabled={Boolean(working)} onClick={() => chooseMarkAction(line, "keep_source")}>Keep as source load</button></p>)}
    </div></PlatformPanel>}
    <PlatformPanel><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><h2 style={{ marginBottom: 4 }}>Outbound load plan</h2><p style={{ marginTop: 0, color: "#94a3b8" }}>Badges show receiving status. Green bale counts match the requested quantity.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input aria-label="Search booking" value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder="Search marks or equipment" style={{ ...input, width: 260 }} />
        <button type="button" style={button} disabled={Boolean(working)} onClick={() => { setMarkError(""); setNewMark({ requestId: crypto.randomUUID(), mark: "", bales: "", shippingOrder: "" }); }}>+ Add mark to booking</button>
        <button type="button" style={button} disabled={Boolean(working) || rollMode} onClick={() => { setRollMode(true); setSearch(""); setError(""); }}>Split / roll marks</button></div>
    </div>

    {rollMode ? <div style={{ margin: "14px 0", padding: 14, borderRadius: 12, border: "1px solid rgba(99,102,241,.45)", background: "rgba(79,70,229,.1)" }}>
      <strong>Split / roll {selectedLines.size} selected mark{selectedLines.size === 1 ? "" : "s"}</strong>
      <p style={{ color: "#cbd5e1", fontSize: 13, margin: "8px 0" }}>Select marks below, enter the destination booking, then move them. Adjust each selected quantity for a partial split. Marks with equipment entered must have that equipment cleared first.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, margin: "10px 0" }}>
        {[...selectedLines].map((lineId) => { const line = lineById.get(lineId); return line ? <label key={lineId} style={{ color: "#cbd5e1", fontSize: 12 }}>{line.mark} bales
          <input type="number" min={1} max={line.requested_bales} style={input} value={rollQuantities[lineId] ?? line.requested_bales}
            onChange={(event) => setRollQuantities((current) => ({ ...current, [lineId]: event.target.value }))} /></label> : null; })}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input aria-label="Destination booking number" style={{ ...input, width: 240 }} value={rollBooking}
        onChange={(event) => setRollBooking(event.target.value.toUpperCase())} placeholder="Destination booking #" />
        <button type="button" style={button} disabled={Boolean(working) || !rollBooking.trim() || selectedLines.size === 0} onClick={() => void rollSelected()}>
          {working === "bulk-roll" ? "Moving marks…" : "Move selected marks"}</button>
        <button type="button" style={button} disabled={Boolean(working)} onClick={() => { setRollMode(false); setSelectedLines(new Set()); setRollQuantities({}); setRollBooking(""); }}>Cancel split / roll</button></div>
    </div> : null}

    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse" }}><thead><tr>
      {[...(rollMode ? ['Select'] : []), '#', 'Mark', 'Bales', 'Container number', 'Seal number', 'Chassis number', 'Notes', 'Actions'].map((label) => <th key={label} style={th}>{label}</th>)}
    </tr></thead><tbody>{visibleContainers.map((row) => {
      if (row.split_transfer_id) return <tr key={row.id} style={{ background: "rgba(71,85,105,.12)", color: "#94a3b8" }}>
        {rollMode && <td style={td} />}<td style={td}>{row.sequence_no}</td>
        <td style={td}><strong>{row.split?.mark ?? "Moved mark"}</strong><small style={{ display: "block", marginTop: 3 }}>Split to booking {row.split?.target_booking_number ?? "—"}</small></td>
        <td style={td}>{row.split?.bales ?? "—"}</td>
        <td style={td} colSpan={4}>{row.split ? <Link style={{ color: "#a5b4fc" }} href={`/warehouse/outbound/${terminal}/${siteCode}/${row.split.target_booking_id}?returnTo=${encodeURIComponent(backHref)}`}>View booking {row.split.target_booking_number}</Link> : "Transferred"}</td>
        <td style={{ ...td, fontSize: 12, fontWeight: 600 }}>Locked</td>
      </tr>;
      const draft = drafts[row.id] ?? { bookingLineId: "", containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" };
      const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
      const locked = line?.line_status === "on_hold" || line?.line_status === "cancelled";
      const saved = draft.bookingLineId === (row.booking_line_id ?? "") && draft.containerNumber === (row.container_number ?? "") && draft.sealNumber === (row.seal_number ?? "") &&
        draft.chassisNumber === (row.chassis_number ?? "") && draft.notes === (row.notes ?? "");
      const hasEquipment = Boolean(draft.containerNumber || draft.sealNumber || draft.chassisNumber || draft.notes);
      return <tr key={row.id} style={{ background: line && line.available_bales > 0 ? "rgba(34,197,94,.035)" : undefined }}>
        {rollMode && <td style={td}>{line ? <input type="checkbox" aria-label={`Select ${line.mark}`} checked={selectedLines.has(line.id)} disabled={hasEquipment || locked}
          title={hasEquipment ? "Clear equipment details before rolling this mark" : "Select mark for split or rollover"} onChange={() => toggleLine(line)} /> : null}</td>}
        <td style={td}><strong>{row.sequence_no}</strong></td>
        <td style={td}>{line ? <><strong style={{ fontSize: 16 }}>{line.mark}</strong><div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>{bookingMarkBadges(line).map((badge) => <span key={badge.label} title={badge.title} style={{ color: badge.color, background: badge.background, border: "none", borderRadius: 20, padding: "2px 7px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{badge.label}</span>)}</div>{line.status_note && <small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>{line.status_note}</small>}{line.load_source === "source_load" && <small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>{line.source_warehouse}</small>}</> : <span style={{ color: "#94a3b8" }}>Extra container</span>}</td>
        <td style={td}>{line && (line.load_source === "source_load" || locked) ? <strong style={{ color: "#94a3b8" }}>{line.requested_bales}</strong> : line ? <strong title={bookingBaleDisplay(line).title} style={{ color: bookingBaleDisplay(line).color, whiteSpace: "nowrap" }}>{bookingBaleDisplay(line).text}</strong> : "—"}</td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} number`} disabled={locked || Boolean(working)} style={input} value={draft.containerNumber} onChange={(e) => change(row, "containerNumber", e.target.value)} placeholder="ABCD1234567" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} seal`} disabled={locked || Boolean(working)} style={input} value={draft.sealNumber} onChange={(e) => change(row, "sealNumber", e.target.value)} placeholder="Seal #" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} chassis`} disabled={locked || Boolean(working)} style={input} value={draft.chassisNumber} onChange={(e) => change(row, "chassisNumber", e.target.value)} onFocus={() => {
          if (terminal === "SAV" && !draft.chassisNumber) change(row, "chassisNumber", "SCMI");
        }} placeholder={terminal === "SAV" ? "SCMI" : "Chassis #"} /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} notes`} disabled={locked || Boolean(working)} style={input} value={draft.notes} onChange={(e) => change(row, "notes", e.target.value)} placeholder="Optional" /></td>
        <td style={{ ...td, color: working === row.id ? "#fbbf24" : saved && row.container_number && row.seal_number ? "#86efac" : "#94a3b8", fontSize: 12, fontWeight: 600 }}>
          {locked ? "Locked" : working === row.id ? "Saving…" : saved && row.container_number && row.seal_number ? "Saved" : draft.containerNumber && draft.sealNumber ? "Auto-saving…" : "Needs container + seal"}
          {line && line.line_status !== "cancelled" && <details className="booking-mark-actions" style={{ marginTop: 8 }}><summary>Mark actions ▾</summary><div>
            <button type="button" style={{ ...button, padding: "5px 7px", fontSize: 11 }} disabled={Boolean(working)} onClick={() => chooseMarkAction(line, locked ? "resume" : "hold")}>{locked ? "Resume" : "Put on hold"}</button>
            <button type="button" style={{ ...button, padding: "5px 7px", fontSize: 11, color: "#94a3b8" }} disabled={Boolean(working)} onClick={() => chooseMarkAction(line, "cancel")}>Cancel mark</button>
            {line.load_source === "source_load" && <button type="button" style={{ ...button, padding: "5px 7px", fontSize: 11 }} disabled={Boolean(working)} onClick={() => chooseMarkAction(line, "warehouse")}>Convert to warehouse load</button>}
          </div></details>}
        </td></tr>;
    })}</tbody></table></div>
    </PlatformPanel>
    {markAction && <div role="dialog" aria-modal="true" aria-labelledby="mark-action-title" style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.8)", zIndex: 50, display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={(event) => void changeMark(event)} style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, boxSizing: "border-box" }}>
        <h2 id="mark-action-title">{markAction.action === "hold" ? "Put on hold" : markAction.action === "resume" ? "Resume mark" : markAction.action === "cancel" ? "Cancel mark from booking" : markAction.action === "warehouse" ? "Convert to warehouse load" : "Keep as source load"}: {markAction.line.mark}</h2>
        <p style={{ color: "#cbd5e1", fontSize: 13 }}>{markAction.action === "hold" ? "Keep this mark on ice. Its equipment and split actions are locked until you resume it." : markAction.action === "cancel" ? "Remove this mark from the booking’s requested total and active load plan. Its history and saved equipment remain visible in a locked row below." : markAction.action === "warehouse" ? `Plan this mark through ${booking.site_name}. This does not mark it as received; normal check-in and warehouse receiving still apply.` : markAction.action === "keep_source" ? "Acknowledge the unexpected arrival and explain why the direct-pickup plan still applies." : "Return this mark to the active plan."}</p>
        <label>Note {markAction.action === "keep_source" ? "(required)" : "(optional)"}<textarea aria-label="Mark action note" required={markAction.action === "keep_source"} maxLength={500} style={input} value={markAction.note} onChange={(event) => setMarkAction((current) => current && { ...current, note: event.target.value })} /></label>
        {actionError && <p role="alert" style={{ color: "#fca5a5" }}>{actionError}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}><button style={button} type="submit" disabled={Boolean(working)}>{working === "mark-action" ? "Saving…" : "Confirm change"}</button><button style={button} type="button" disabled={Boolean(working)} onClick={() => setMarkAction(null)}>Back</button></div>
      </form>
    </div>}
    {newMark && <div role="dialog" aria-modal="true" aria-labelledby="add-mark-title" style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.8)", zIndex: 50, display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={(event) => void addMark(event)} style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: 12, padding: 24, width: "100%", maxWidth: 460, boxSizing: "border-box" }}>
        <h2 id="add-mark-title" style={{ marginTop: 0 }}>Add mark to booking</h2>
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Add the mark and requested bales to booking {booking.booking_number}. Container details can be entered on its row afterward.</p>
        {markError && <p role="alert" style={{ color: "#fca5a5" }}>{markError}</p>}
        <div style={{ display: "grid", gap: 14 }}>
          <label>Mark<input autoFocus required maxLength={80} value={newMark.mark} disabled={Boolean(working)} style={input} onChange={(event) => setNewMark((current) => current && { ...current, mark: event.target.value.toUpperCase() })} /></label>
          <label>Requested bales<input required type="number" min={1} max={1000000} step={1} value={newMark.bales} disabled={Boolean(working)} style={input} onChange={(event) => setNewMark((current) => current && { ...current, bales: event.target.value })} /></label>
          <label>Shipping order (optional)<input maxLength={200} value={newMark.shippingOrder} disabled={Boolean(working)} style={input} onChange={(event) => setNewMark((current) => current && { ...current, shippingOrder: event.target.value })} /></label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}><button type="submit" disabled={Boolean(working)} style={button}>{working === "add-mark" ? "Adding mark…" : "Add mark"}</button>
          <button type="button" disabled={Boolean(working)} onClick={() => setNewMark(null)} style={button}>Cancel</button></div>
      </form>
    </div>}
  </main>;
}
