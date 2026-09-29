"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

type Container = { id: string; sequence_no: number; booking_line_id: string | null; container_number: string | null; seal_number: string | null;
  chassis_number: string | null; notes: string | null; updated_at: string };
type Line = { id: string; source_row: number; mark: string; requested_bales: number; mark_requested_total: number; available_bales: number;
  load_by: string; shipping_order: string | null; inventory_locations: string[]; inbound_bales: number; inbound_statuses: string[] };
type Booking = { id: string; booking_number: string; customer: string; customer_reference: string | null;
  requested_bales: number; planned_containers: number | null; site_name: string; status: string };
type Draft = { bookingLineId: string; containerNumber: string; sealNumber: string; chassisNumber: string; notes: string };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
const button: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #475569",
  background: "#0f172a", color: "#f8fafc", cursor: "pointer", fontWeight: 700, textDecoration: "none" };
const th: React.CSSProperties = { padding: "10px", borderBottom: "1px solid #475569", color: "#94a3b8", fontSize: 12, textAlign: "left" };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: "1px solid rgba(71,85,105,.45)" };

export default function CottonOutboundBookingPage() {
  const params = useParams<{ terminal: string; siteCode: string; id: string }>();
  const terminal = String(params.terminal ?? "").toUpperCase();
  const siteCode = String(params.siteCode ?? "");
  const id = String(params.id ?? "");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [rollLineId, setRollLineId] = useState("");
  const [rollBooking, setRollBooking] = useState("");
  const [rollBales, setRollBales] = useState("");
  const saveTimers = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ terminal, siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooking(result.booking); setContainers(result.containers); setLines(result.lines);
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

  async function rollLine(line: Line) {
    setWorking(`roll-${line.id}`); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/lines/${line.id}/rollover`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, targetBookingNumber: rollBooking, bales: Number(rollBales) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setRollLineId(""); setRollBooking(""); setRollBales("");
      setMessage(`${rollBales} bales of ${line.mark} moved to booking ${result.targetBookingNumber}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not roll mark"); }
    finally { setWorking(""); }
  }

  if (loading) return <main style={{ color: "#e2e8f0" }}>Loading booking…</main>;
  if (!booking) return <main><PlatformPageHeader title="Outbound Booking Not Found" actions={<Link href="/warehouse/outbound" style={button}>Back</Link>} />{error && <p style={{ color: "#fca5a5" }}>{error}</p>}</main>;
  const complete = containers.filter((row) => row.container_number && row.seal_number && row.chassis_number).length;
  const orderedLines = [...lines].sort((a, b) => Number(b.available_bales > 0) - Number(a.available_bales > 0)
    || a.mark.localeCompare(b.mark) || String(a.shipping_order ?? "").localeCompare(String(b.shipping_order ?? "")));
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const term = search.trim().toUpperCase();
  const visibleContainers = containers.filter((row) => {
    const assigned = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
    return !term || [row.sequence_no, row.container_number, row.seal_number, row.chassis_number, row.notes,
      assigned?.mark, assigned?.shipping_order].some((value) => String(value ?? "").toUpperCase().includes(term));
  });
  const visibleLines = orderedLines.filter((line) => !term || [line.mark, line.shipping_order, ...line.inventory_locations]
    .some((value) => String(value ?? "").toUpperCase().includes(term)));
  return <main style={{ maxWidth: 1550, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title={`Booking ${booking.booking_number}`} subtitle={`${booking.site_name} · ${booking.customer}`}
      actions={<><a href={`/api/warehouse/outbound/bookings/${id}/export?terminal=${terminal}&siteCode=${siteCode}`} style={button}>Export Excel</a>
        <Link href="/warehouse/outbound" style={button}>← All outbound bookings</Link></>} />
    <PlatformPanel><div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <strong>{booking.requested_bales} requested bales</strong><span>{booking.planned_containers ?? "—"} planned containers</span>
      <span>{complete} of {containers.length} equipment rows complete</span><span>Customer ref {booking.customer_reference || "—"}</span>
    </div>{error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}</PlatformPanel>

    <PlatformPanel><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><h2 style={{ marginBottom: 4 }}>Container equipment</h2><p style={{ marginTop: 0, color: "#94a3b8" }}>Enter the container, seal, and chassis as each unit is assigned.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input aria-label="Search booking" value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder="Search marks or equipment" style={{ ...input, width: 260 }} />
      <button type="button" style={button} disabled={Boolean(working)} onClick={() => void addContainer()}>{working === "add" ? "Adding…" : "+ Add container"}</button></div>
    </div>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}><thead><tr>
      {['#', 'Mark', 'Container number', 'Seal number', 'Chassis number', 'Notes', 'Status'].map((label) => <th key={label} style={th}>{label}</th>)}
    </tr></thead><tbody>{visibleContainers.map((row) => {
      const draft = drafts[row.id] ?? { bookingLineId: "", containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" };
      const saved = draft.bookingLineId === (row.booking_line_id ?? "") && draft.containerNumber === (row.container_number ?? "") && draft.sealNumber === (row.seal_number ?? "") &&
        draft.chassisNumber === (row.chassis_number ?? "") && draft.notes === (row.notes ?? "");
      return <tr key={row.id}><td style={td}><strong>{row.sequence_no}</strong></td>
        <td style={td}>{row.booking_line_id && lineById.get(row.booking_line_id) ? <><strong>{lineById.get(row.booking_line_id)!.mark}</strong>
          <small style={{ display: "block", color: "#94a3b8", marginTop: 3 }}>{lineById.get(row.booking_line_id)!.requested_bales} bales{lineById.get(row.booking_line_id)!.available_bales > 0 ? " · in warehouse" : ""}</small></> : <span style={{ color: "#fbbf24" }}>Unassigned</span>}</td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} number`} style={input} value={draft.containerNumber} onChange={(e) => change(row, "containerNumber", e.target.value)} placeholder="ABCD1234567" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} seal`} style={input} value={draft.sealNumber} onChange={(e) => change(row, "sealNumber", e.target.value)} placeholder="Seal #" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} chassis`} style={input} value={draft.chassisNumber} onChange={(e) => change(row, "chassisNumber", e.target.value)} onFocus={() => {
          if (terminal === "SAV" && !draft.chassisNumber) change(row, "chassisNumber", "SCMI");
        }} placeholder={terminal === "SAV" ? "SCMI" : "Chassis #"} /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} notes`} style={input} value={draft.notes} onChange={(e) => change(row, "notes", e.target.value)} placeholder="Optional" /></td>
        <td style={{ ...td, color: working === row.id ? "#fbbf24" : saved && row.container_number && row.seal_number ? "#86efac" : "#94a3b8", fontSize: 12, fontWeight: 800 }}>
          {working === row.id ? "Saving…" : saved && row.container_number && row.seal_number ? "Saved" : draft.containerNumber && draft.sealNumber ? "Saving automatically…" : "Enter container + seal"}
        </td></tr>;
    })}</tbody></table></div></PlatformPanel>

    <PlatformPanel><h2>Marks and inventory</h2><p style={{ color: "#94a3b8" }}>Availability reflects active, unallocated inventory at this warehouse.</p>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}><thead><tr>
        {['Mark', 'Requested', 'Status', 'Available', 'Inbound', 'Difference', 'Load by', 'S.O.', 'Location', ''].map((label) => <th key={label} style={th}>{label}</th>)}</tr></thead><tbody>
        {visibleLines.map((line) => <tr key={line.id}><td style={td}>{line.mark}</td><td style={td}>{line.requested_bales}</td>
          <td style={td}><span style={{ color: line.available_bales >= line.mark_requested_total ? "#86efac" : line.inbound_bales > 0 ? "#fbbf24" : "#fca5a5", fontWeight: 800 }}>
            {line.available_bales >= line.mark_requested_total ? "In warehouse" : line.inbound_bales > 0 ? "In delivery line" : line.available_bales > 0 ? "Short in warehouse" : "Not in warehouse"}
          </span></td><td style={td}>{line.available_bales}</td><td style={td}>{line.inbound_bales || "—"}</td>
          <td style={{ ...td, color: line.available_bales < line.mark_requested_total ? "#fca5a5" : "#86efac" }}>{line.available_bales - line.mark_requested_total}</td>
          <td style={td}>{line.load_by}</td><td style={td}>{line.shipping_order || "—"}</td><td style={td}>{line.inventory_locations.join(", ") || "—"}</td>
          <td style={td}>{rollLineId === line.id ? <div style={{ display: "grid", gap: 6, minWidth: 180 }}>
            <input style={input} value={rollBooking} onChange={(e) => setRollBooking(e.target.value.toUpperCase())} placeholder="New booking #" />
            <input style={input} type="number" min={1} max={line.requested_bales} value={rollBales} onChange={(e) => setRollBales(e.target.value)} placeholder="Bales to move" />
            <div style={{ display: "flex", gap: 6 }}><button style={button} disabled={Boolean(working)} onClick={() => void rollLine(line)}>{working === `roll-${line.id}` ? "Moving…" : "Move"}</button>
              <button style={button} disabled={Boolean(working)} onClick={() => setRollLineId("")}>Cancel</button></div>
          </div> : <button style={button} onClick={() => { setRollLineId(line.id); setRollBales(String(line.requested_bales)); setRollBooking(""); }}>Split / roll</button>}</td></tr>)}
      </tbody></table></div>
    </PlatformPanel>
  </main>;
}
