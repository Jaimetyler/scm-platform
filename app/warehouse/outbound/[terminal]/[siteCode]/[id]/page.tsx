"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { bookingDateInput, formatBookingDate } from "@/lib/warehouse/outbound/details";

type Container = { id: string; sequence_no: number; booking_line_id: string | null; container_number: string | null; seal_number: string | null;
  chassis_number: string | null; notes: string | null; updated_at: string; split_transfer_id: string | null;
  split: { mark: string; bales: number; target_booking_id: string; target_booking_number: string } | null };
type Line = { id: string; source_row: number; mark: string; requested_bales: number; mark_requested_total: number; available_bales: number;
  load_by: string; shipping_order: string | null; inventory_locations: string[]; inbound_bales: number; inbound_statuses: string[] };
type Booking = { id: string; booking_number: string; customer: string; customer_reference: string | null;
  requested_bales: number; planned_containers: number | null; site_name: string; status: string; doc_cutoff_has_time: boolean; cutoff_has_time: boolean; erd: string | null; doc_cutoff: string | null; cutoff: string | null; vessel: string | null; updated_at: string };
type Draft = { bookingLineId: string; containerNumber: string; sealNumber: string; chassisNumber: string; notes: string };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
const button: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #475569",
  background: "#0f172a", color: "#f8fafc", cursor: "pointer", fontWeight: 700, textDecoration: "none" };
const th: React.CSSProperties = { padding: "10px", borderBottom: "1px solid #475569", color: "#94a3b8", fontSize: 12, textAlign: "left" };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: "1px solid rgba(71,85,105,.45)" };

function CutoffInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [date, time = ""] = value.split("T");
  return <div><span>{label}</span><div style={{ display: "flex", gap: 6 }}>
    <input aria-label={`${label} date`} type="date" style={input} value={date} onChange={(event) => onChange(event.target.value ? `${event.target.value}${time ? `T${time}` : ""}` : "")} />
    <input aria-label={`${label} time (optional)`} type="time" disabled={!date} style={{ ...input, maxWidth: 135 }} value={time}
      onChange={(event) => onChange(`${date}${event.target.value ? `T${event.target.value}` : ""}`)} />
  </div></div>;
}

export default function CottonOutboundBookingPage() {
  const queryParams = useSearchParams();
  const params = useParams<{ terminal: string; siteCode: string; id: string }>();
  const terminal = String(params.terminal ?? "").toUpperCase();
  const siteCode = String(params.siteCode ?? "");
  const id = String(params.id ?? "");
  const requestedReturn = queryParams.get("returnTo");
  const backHref = requestedReturn?.startsWith("/warehouse/outbound?") ? requestedReturn : `/warehouse/outbound?terminal=${terminal}&siteCode=${siteCode}`;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [rollBooking, setRollBooking] = useState("");
  const [rollQuantities, setRollQuantities] = useState<Record<string, string>>({});
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState({ erd: "", docCutoff: "", cutoff: "", vessel: "" });
  const [importedDateNotes, setImportedDateNotes] = useState<string[]>([]);
  const requestInput = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ terminal, siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooking(result.booking); setContainers(result.containers); setLines(result.lines); setSelectedLines(new Set());
      setDrafts(Object.fromEntries((result.containers as Container[]).map((row) => [row.id, {
        bookingLineId: row.booking_line_id ?? "", containerNumber: row.container_number ?? "", sealNumber: row.seal_number ?? "",
        chassisNumber: row.chassis_number ?? "", notes: row.notes ?? "",
      }])));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load booking"); }
    finally { setLoading(false); }
  }, [id, terminal, siteCode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { Object.values(saveTimers.current).forEach((timer) => window.clearTimeout(timer)); }, []);

  function change(row: Container, field: keyof Draft, value: string) {
    if (row.split_transfer_id) return;
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
    if (row.split_transfer_id) return;
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
  async function addContainer() {
    setWorking("add"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/containers`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminal, siteCode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const row = result.container as Container;
      setContainers((current) => [...current, row]);
      setDrafts((current) => ({ ...current, [row.id]: { bookingLineId: "", containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" } }));
      setMessage(`Container ${row.sequence_no} added.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add container"); }
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
    setWorking("bulk-roll"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/rollover`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, targetBookingNumber: rollBooking, moves }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setRollBooking(""); setRollQuantities({}); setSelectedLines(new Set());
      setMessage(`${moves.length} mark${moves.length === 1 ? "" : "s"} moved to booking ${result.targetBookingNumber}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not roll selected marks"); }
    finally { setWorking(""); }
  }

  function editDetails() {
    if (!booking) return;
    setDetails({ erd: bookingDateInput(booking.erd), docCutoff: bookingDateInput(booking.doc_cutoff, booking.doc_cutoff_has_time !== false),
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
      if (result.mismatches.length) throw new Error("The request does not match this warehouse.");
      const source = result.booking;
      if (!source.erd && !source.docCutoff && !source.cutoff && !source.vessel) throw new Error("No sailing details were found in this request.");
      setDetails({ erd: source.erd ?? bookingDateInput(booking.erd),
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
  const activeContainers = containers.filter((row) => !row.split_transfer_id);
  const complete = activeContainers.filter((row) => row.container_number && row.seal_number && row.chassis_number).length;
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const term = search.trim().toUpperCase();
  const visibleContainers = containers.filter((row) => {
    const assigned = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
    return !term || [row.sequence_no, row.container_number, row.seal_number, row.chassis_number, row.notes,
      assigned?.mark, assigned?.shipping_order, row.split?.mark, row.split?.target_booking_number].some((value) => String(value ?? "").toUpperCase().includes(term));
  }).sort((a, b) => Number(Boolean(a.split_transfer_id)) - Number(Boolean(b.split_transfer_id)) || a.sequence_no - b.sequence_no);
  return <main style={{ maxWidth: 1550, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title={`Booking ${booking.booking_number}`} subtitle={`${booking.site_name} · ${booking.customer}`}
      actions={<><a href={`/api/warehouse/outbound/bookings/${id}/export?terminal=${terminal}&siteCode=${siteCode}`} style={button}>Export Excel</a>
        <Link href={backHref} style={button}>← All outbound bookings</Link></>} />
    <PlatformPanel><div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <strong>{booking.requested_bales} requested bales</strong><span>{booking.planned_containers ?? "—"} planned containers</span>
      <span>{complete} of {activeContainers.length} equipment rows complete</span><span>Customer ref {booking.customer_reference || "—"}</span>
    </div>
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
      <span><strong>ERD</strong> {formatBookingDate(booking.erd)}</span>
      <span><strong>Doc cutoff</strong> {formatBookingDate(booking.doc_cutoff, booking.doc_cutoff_has_time !== false)}</span>
      <span><strong>Cutoff</strong> {formatBookingDate(booking.cutoff, booking.cutoff_has_time !== false)}</span>
      {booking.vessel ? <span><strong>Vessel</strong> {booking.vessel}</span> : null}
      <button type="button" style={button} disabled={Boolean(working) || editingDetails} onClick={editDetails}>Edit booking details</button>
      <input ref={requestInput} type="file" accept=".xlsx" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDetails(file); }} />
      <button type="button" style={button} disabled={Boolean(working) || editingDetails} onClick={() => requestInput.current?.click()}>{working === "import-details" ? "Reading request…" : "Import dates from Excel"}</button>
    </div>
    {editingDetails ? <form onSubmit={(event) => void saveDetails(event)} style={{ marginTop: 16 }}>
      {importedDateNotes.length ? <p style={{ color: "#fbbf24", fontSize: 12 }}>{importedDateNotes.join(" · ")}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <label>ERD<input type="date" style={input} value={details.erd} onChange={(event) => setDetails((current) => ({ ...current, erd: event.target.value }))} /></label>
        <CutoffInput label="Doc cutoff" value={details.docCutoff} onChange={(value) => setDetails((current) => ({ ...current, docCutoff: value }))} />
        <CutoffInput label="Cutoff" value={details.cutoff} onChange={(value) => setDetails((current) => ({ ...current, cutoff: value }))} />
        <label>Vessel<input style={input} maxLength={200} value={details.vessel} onChange={(event) => setDetails((current) => ({ ...current, vessel: event.target.value }))} /></label>
      </div><p style={{ color: "#94a3b8", fontSize: 12 }}>Times are optional and local to {booking.site_name}.</p>
      <div style={{ display: "flex", gap: 8 }}><button style={button} type="submit" disabled={Boolean(working)}>{working === "details" ? "Saving…" : "Save details"}</button>
        <button style={button} type="button" disabled={Boolean(working)} onClick={() => { setEditingDetails(false); setMessage(""); }}>Cancel</button></div>
    </form> : null}
    {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}</PlatformPanel>

    <PlatformPanel><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><h2 style={{ marginBottom: 4 }}>Outbound load plan</h2><p style={{ marginTop: 0, color: "#94a3b8" }}>Green marks have inventory at this warehouse. Red marks have not arrived yet.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input aria-label="Search booking" value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder="Search marks or equipment" style={{ ...input, width: 260 }} />
        <button type="button" style={button} disabled={Boolean(working)} onClick={() => void addContainer()}>{working === "add" ? "Adding…" : "+ Add container"}</button></div>
    </div>

    {selectedLines.size > 0 ? <div style={{ margin: "14px 0", padding: 14, borderRadius: 12, border: "1px solid rgba(99,102,241,.45)", background: "rgba(79,70,229,.1)" }}>
      <strong>Split / roll {selectedLines.size} selected mark{selectedLines.size === 1 ? "" : "s"}</strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, margin: "10px 0" }}>
        {[...selectedLines].map((lineId) => { const line = lineById.get(lineId); return line ? <label key={lineId} style={{ color: "#cbd5e1", fontSize: 12 }}>{line.mark} bales
          <input type="number" min={1} max={line.requested_bales} style={input} value={rollQuantities[lineId] ?? line.requested_bales}
            onChange={(event) => setRollQuantities((current) => ({ ...current, [lineId]: event.target.value }))} /></label> : null; })}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input style={{ ...input, width: 240 }} value={rollBooking}
        onChange={(event) => setRollBooking(event.target.value.toUpperCase())} placeholder="Destination booking #" />
        <button type="button" style={button} disabled={Boolean(working) || !rollBooking.trim()} onClick={() => void rollSelected()}>
          {working === "bulk-roll" ? "Moving marks…" : "Move selected marks"}</button>
        <button type="button" style={button} disabled={Boolean(working)} onClick={() => setSelectedLines(new Set())}>Clear selection</button></div>
    </div> : null}

    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 1440, borderCollapse: "collapse" }}><thead><tr>
      {['', '#', 'Mark', 'Requested', 'Bales / inbound', 'S.O.', 'Location', 'Container number', 'Seal number', 'Chassis number', 'Notes', 'Save'].map((label) => <th key={label} style={th}>{label}</th>)}
    </tr></thead><tbody>{visibleContainers.map((row) => {
      if (row.split_transfer_id) return <tr key={row.id} style={{ background: "rgba(71,85,105,.12)", color: "#94a3b8" }}>
        <td style={td} /><td style={td}>{row.sequence_no}</td>
        <td style={td}><strong>{row.split?.mark ?? "Moved mark"}</strong><small style={{ display: "block", marginTop: 3 }}>Split to booking {row.split?.target_booking_number ?? "—"}</small></td>
        <td style={td}>{row.split?.bales ?? "—"}</td>
        <td style={td} colSpan={7}>{row.split ? <Link style={{ color: "#a5b4fc" }} href={`/warehouse/outbound/${terminal}/${siteCode}/${row.split.target_booking_id}?returnTo=${encodeURIComponent(backHref)}`}>View booking {row.split.target_booking_number}</Link> : "Transferred"}</td>
        <td style={{ ...td, fontSize: 12, fontWeight: 800 }}>Locked</td>
      </tr>;
      const draft = drafts[row.id] ?? { bookingLineId: "", containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" };
      const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
      const saved = draft.bookingLineId === (row.booking_line_id ?? "") && draft.containerNumber === (row.container_number ?? "") && draft.sealNumber === (row.seal_number ?? "") &&
        draft.chassisNumber === (row.chassis_number ?? "") && draft.notes === (row.notes ?? "");
      const hasEquipment = Boolean(draft.containerNumber || draft.sealNumber || draft.chassisNumber || draft.notes);
      return <tr key={row.id} style={{ background: line && line.available_bales > 0 ? "rgba(34,197,94,.035)" : undefined }}>
        <td style={td}>{line ? <input type="checkbox" aria-label={`Select ${line.mark}`} checked={selectedLines.has(line.id)} disabled={hasEquipment}
          title={hasEquipment ? "Clear equipment details before rolling this mark" : "Select mark for split or rollover"} onChange={() => toggleLine(line)} /> : null}</td>
        <td style={td}><strong>{row.sequence_no}</strong></td>
        <td style={td}>{line ? <><strong style={{ color: line.available_bales > 0 ? "#4ade80" : "#f87171", fontSize: 16 }}>{line.mark}</strong>
          <small style={{ display: "block", color: line.available_bales > 0 ? "#86efac" : line.inbound_bales > 0 ? "#fbbf24" : "#fca5a5", marginTop: 3 }}>
            {line.available_bales > 0 ? "In warehouse" : line.inbound_bales > 0 ? "Checked into delivery line" : "Not received"}</small></> : <span style={{ color: "#94a3b8" }}>Extra container</span>}</td>
        <td style={td}>{line?.requested_bales ?? "—"}</td>
        <td style={td}>{line ? <>{line.available_bales}{line.inbound_bales > 0 ? <small style={{ display: "block", color: "#fbbf24" }}>{line.inbound_bales} inbound</small> : null}</> : "—"}</td>
        <td style={td}>{line?.shipping_order || "—"}</td><td style={td}>{line?.inventory_locations.join(", ") || "—"}</td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} number`} style={input} value={draft.containerNumber} onChange={(e) => change(row, "containerNumber", e.target.value)} placeholder="ABCD1234567" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} seal`} style={input} value={draft.sealNumber} onChange={(e) => change(row, "sealNumber", e.target.value)} placeholder="Seal #" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} chassis`} style={input} value={draft.chassisNumber} onChange={(e) => change(row, "chassisNumber", e.target.value)} onFocus={() => {
          if (terminal === "SAV" && !draft.chassisNumber) change(row, "chassisNumber", "SCMI");
        }} placeholder={terminal === "SAV" ? "SCMI" : "Chassis #"} /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} notes`} style={input} value={draft.notes} onChange={(e) => change(row, "notes", e.target.value)} placeholder="Optional" /></td>
        <td style={{ ...td, color: working === row.id ? "#fbbf24" : saved && row.container_number && row.seal_number ? "#86efac" : "#94a3b8", fontSize: 12, fontWeight: 800 }}>
          {working === row.id ? "Saving…" : saved && row.container_number && row.seal_number ? "Saved" : draft.containerNumber && draft.sealNumber ? "Auto-saving…" : "Needs container + seal"}
        </td></tr>;
    })}</tbody></table></div>
    </PlatformPanel>
  </main>;
}
