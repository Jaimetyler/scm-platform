"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

type Container = { id: string; sequence_no: number; container_number: string | null; seal_number: string | null;
  chassis_number: string | null; notes: string | null; updated_at: string };
type Line = { source_row: number; mark: string; requested_bales: number; mark_requested_total: number; available_bales: number;
  load_by: string; shipping_order: string | null; inventory_locations: string[] };
type Booking = { id: string; booking_number: string; customer: string; customer_reference: string | null;
  requested_bales: number; planned_containers: number | null; site_name: string; status: string };
type Draft = { containerNumber: string; sealNumber: string; chassisNumber: string; notes: string };
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

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ terminal, siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooking(result.booking); setContainers(result.containers); setLines(result.lines);
      setDrafts(Object.fromEntries((result.containers as Container[]).map((row) => [row.id, {
        containerNumber: row.container_number ?? "", sealNumber: row.seal_number ?? "",
        chassisNumber: row.chassis_number ?? "", notes: row.notes ?? "",
      }])));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load booking"); }
    finally { setLoading(false); }
  }, [id, terminal, siteCode]);
  useEffect(() => { void load(); }, [load]);

  function change(row: Container, field: keyof Draft, value: string) {
    const nextValue = field === "notes" ? value : value.toUpperCase();
    setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], [field]: nextValue } }));
    setMessage("");
  }
  async function save(row: Container) {
    setWorking(row.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/containers`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, containerId: row.id, expectedUpdatedAt: row.updated_at, ...drafts[row.id] }),
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
      setDrafts((current) => ({ ...current, [row.id]: { containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" } }));
      setMessage(`Container ${row.sequence_no} added.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add container"); }
    finally { setWorking(""); }
  }

  if (loading) return <main style={{ color: "#e2e8f0" }}>Loading booking…</main>;
  if (!booking) return <main><PlatformPageHeader title="Outbound Booking Not Found" actions={<Link href="/warehouse/outbound" style={button}>Back</Link>} />{error && <p style={{ color: "#fca5a5" }}>{error}</p>}</main>;
  const complete = containers.filter((row) => row.container_number && row.seal_number && row.chassis_number).length;
  return <main style={{ maxWidth: 1550, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title={`Booking ${booking.booking_number}`} subtitle={`${booking.site_name} · ${booking.customer}`}
      actions={<Link href="/warehouse/outbound" style={button}>← All outbound bookings</Link>} />
    <PlatformPanel><div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <strong>{booking.requested_bales} requested bales</strong><span>{booking.planned_containers ?? "—"} planned containers</span>
      <span>{complete} of {containers.length} equipment rows complete</span><span>Customer ref {booking.customer_reference || "—"}</span>
    </div>{error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}</PlatformPanel>

    <PlatformPanel><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><h2 style={{ marginBottom: 4 }}>Container equipment</h2><p style={{ marginTop: 0, color: "#94a3b8" }}>Enter the container, seal, and chassis as each unit is assigned.</p></div>
      <button type="button" style={button} disabled={Boolean(working)} onClick={() => void addContainer()}>{working === "add" ? "Adding…" : "+ Add container"}</button>
    </div>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}><thead><tr>
      {['#', 'Container number', 'Seal number', 'Chassis number', 'Notes', ''].map((label) => <th key={label} style={th}>{label}</th>)}
    </tr></thead><tbody>{containers.map((row) => {
      const draft = drafts[row.id] ?? { containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" };
      const saved = draft.containerNumber === (row.container_number ?? "") && draft.sealNumber === (row.seal_number ?? "") &&
        draft.chassisNumber === (row.chassis_number ?? "") && draft.notes === (row.notes ?? "");
      return <tr key={row.id}><td style={td}><strong>{row.sequence_no}</strong></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} number`} style={input} value={draft.containerNumber} onChange={(e) => change(row, "containerNumber", e.target.value)} placeholder="ABCD1234567" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} seal`} style={input} value={draft.sealNumber} onChange={(e) => change(row, "sealNumber", e.target.value)} placeholder="Seal #" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} chassis`} style={input} value={draft.chassisNumber} onChange={(e) => change(row, "chassisNumber", e.target.value)} placeholder="Chassis #" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} notes`} style={input} value={draft.notes} onChange={(e) => change(row, "notes", e.target.value)} placeholder="Optional" /></td>
        <td style={td}><button type="button" style={button} disabled={saved || Boolean(working)} onClick={() => void save(row)}>{working === row.id ? "Saving…" : saved ? "Saved" : "Save"}</button></td></tr>;
    })}</tbody></table></div></PlatformPanel>

    <PlatformPanel><h2>Marks and inventory</h2><p style={{ color: "#94a3b8" }}>Availability reflects active, unallocated inventory at this warehouse.</p>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}><thead><tr>
        {['Mark', 'Requested', 'Available', 'Difference', 'Load by', 'S.O.', 'Location'].map((label) => <th key={label} style={th}>{label}</th>)}</tr></thead><tbody>
        {lines.map((line) => <tr key={line.source_row}><td style={td}>{line.mark}</td><td style={td}>{line.requested_bales}</td><td style={td}>{line.available_bales}</td>
          <td style={{ ...td, color: line.available_bales < line.mark_requested_total ? "#fca5a5" : "#86efac" }}>{line.available_bales - line.mark_requested_total}</td>
          <td style={td}>{line.load_by}</td><td style={td}>{line.shipping_order || "—"}</td><td style={td}>{line.inventory_locations.join(", ") || "—"}</td></tr>)}
      </tbody></table></div>
    </PlatformPanel>
  </main>;
}
