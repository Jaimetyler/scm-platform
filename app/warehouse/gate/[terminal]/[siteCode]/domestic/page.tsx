"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type Status = "waiting" | "called" | "in_door" | "working";
type YardStatus = Status | "completed" | "cancelled" | null;
type Row = {
  id: string; updated_at: string; checked_in_at: string; driver_name: string; driver_phone: string;
  movement_direction: string; material_type: string; reference_number: string;
  destination: string | null; shipper: string | null; matched_order_id: string | null;
  warehouse_location: string | null; comment_1: string | null; mark: string | null; bol_bc: number | null;
  draft_status: string; has_bol_photo: boolean; yard_status: YardStatus;
  yard_called_at: string | null; yard_in_door_at: string | null;
  yard_work_started_at: string | null;
};
type Match = { orderId: string; customerId: string; customerName: string; value: string };
const LABEL: Record<Status, string> = {
  waiting: "Waiting", called: "Called", in_door: "In door", working: "Loading / Unloading",
};
const NEXT: Record<Status, { label: string; to: string }> = {
  waiting: { label: "Call driver", to: "called" },
  called: { label: "In door", to: "in_door" },
  in_door: { label: "Start work", to: "working" },
  working: { label: "Complete", to: "completed" },
};
const PREVIOUS: Partial<Record<Status, string>> = { called: "waiting", in_door: "called", working: "in_door" };

export default function DomesticQueuePage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [working, setWorking] = useState("");
  const [tick, setTick] = useState(0);
  const [matches, setMatches] = useState<Record<string, Match[]>>({});
  const [matchWorking, setMatchWorking] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!site) return;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode });
      const response = await fetch(`/api/warehouse/domestic-queue?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load arrivals");
      setRows(result.rows);
      setError("");
      setLoadError(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load arrivals");
      setLoadError(true);
      setRows([]);
    } finally { setLoading(false); }
  }, [site]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(true); setTick((value) => value + 1); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function transition(row: Row & { yard_status: Status }, to: string) {
    if (!site) return;
    if (to === "cancelled" && !window.confirm(`Remove ${row.driver_name} from the domestic queue?`)) return;
    setWorking(row.id);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, from: row.yard_status, to, terminal: site.terminal, siteCode: site.siteCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not update arrival");
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update arrival"); }
    finally { setWorking(""); }
  }

  async function findOrder(row: Row) {
    setMatchWorking(row.id);
    setError("");
    try {
      const response = await fetch(`/api/warehouse/domestic-queue/match?id=${encodeURIComponent(row.id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "McLeod search failed");
      setMatches((current) => ({ ...current, [row.id]: result.matches }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "McLeod search failed"); }
    finally { setMatchWorking(""); }
  }

  async function saveCustomer(row: Row, customer: string, orderId?: string) {
    if (!site || (!orderId && customer.trim().toUpperCase() === (row.shipper ?? ""))) return;
    setWorking(row.id);
    setError("");
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, terminal: site.terminal, siteCode: site.siteCode,
          expectedUpdatedAt: row.updated_at, action: orderId ? "match_order" : "set_customer", customer, orderId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save customer");
      setMatches((current) => { const next = { ...current }; delete next[row.id]; return next; });
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save customer"); }
    finally { setWorking(""); }
  }

  async function saveField(row: Row, field: "reference_number" | "warehouse_location" | "comment_1", value: string) {
    if (!site || value.trim().toUpperCase() === String(row[field] ?? "")) return;
    setWorking(row.id);
    setError("");
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, terminal: site.terminal, siteCode: site.siteCode,
          expectedUpdatedAt: row.updated_at, action: "edit_field", field, value }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save cell");
      setMatches((current) => { const next = { ...current }; delete next[row.id]; return next; });
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save cell"); }
    finally { setWorking(""); }
  }

  if (!site) return <main><PlatformPageHeader title="Domestic Queue Not Found" /></main>;
  const active = rows.filter((row): row is Row & { yard_status: Status } => row.yard_status === "waiting" || row.yard_status === "called" || row.yard_status === "in_door" || row.yard_status === "working").reverse();
  const recent = rows.filter((row) => !active.some((item) => item.id === row.id));
  const counts = Object.keys(LABEL).map((status) => `${active.filter((row) => row.yard_status === status).length} ${LABEL[status as Status].toLowerCase()}`);
  return <main style={{ width: "100%", maxWidth: "100%", margin: "0 auto", padding: "0 12px", boxSizing: "border-box" }}>
    <PlatformPageHeader title={`${site.siteName} Check-In`}
      subtitle="Lumber and other freight arrivals. Move each truck through the yard as work progresses."
      actions={<><Link href="/inbound/checkin" style={button}>All check-in sites</Link>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/containers`} style={button}>Container line</Link></>} />
    <nav aria-label="Freight type" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
      <Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={button}>Cotton</Link>
      <span aria-current="page" style={primary}>Lumber & Other</span>
    </nav>
    {error && <div role="alert" style={{ color: "#fecaca", marginBottom: 14 }}>{error}</div>}
    <PlatformPanel>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <strong style={{ color: "#f8fafc" }}>{counts.join(" · ")}</strong>
        <button style={button} onClick={() => void load()}>Refresh</button>
      </div>
      {loading ? <p style={muted}>Loading arrivals…</p> : loadError ? null : active.length === 0 ?
        <p style={muted}>No active lumber or other freight arrivals.</p> :
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1760, tableLayout: "fixed", borderCollapse: "collapse", color: "#e2e8f0", fontSize: 13 }}>
            <colgroup>{[3, 5, 5, 6, 8, 9, 9, 8, 8, 8, 9, 8, 14].map((width, index) =>
              <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead><tr>{["#", "Arrived", "Move", "Material", "McLeod field", "Reference", "Customer", "Order match", "Driver", "Destination", "Warehouse location", "Notes", "Status / action"].map((label) =>
              <th key={label} style={heading}>{label}</th>)}</tr></thead>
            <tbody>{active.map((row, index) => <tr key={row.id}>
              <td style={cell}>{index + 1}</td>
              <td style={cell}>{time(row.checked_in_at, site.terminal)}<div style={muted}>{elapsed(row.checked_in_at, tick)}</div></td>
              <td style={cell}>{row.movement_direction}</td>
              <td style={cell}>{row.material_type}</td>
              <td style={cell}>{row.movement_direction === "pickup" ? "BLNUM" : "consignee_refno"}</td>
              <td style={cell}><input key={row.updated_at} aria-label={`Reference for ${row.driver_name}`} defaultValue={row.reference_number}
                onBlur={(event) => void saveField(row, "reference_number", event.target.value)} style={sheetInput} />
                <div><Link href={`/warehouse/checkin/${row.id}`} style={{ color: "#67e8f9" }}>{row.has_bol_photo ? "Paperwork" : "Details"}</Link></div></td>
              <td style={cell}><input key={row.updated_at} aria-label={`Customer for ${row.driver_name}`}
                defaultValue={row.shipper ?? ""} placeholder="Enter customer"
                onBlur={(event) => void saveCustomer(row, event.target.value)} style={sheetInput} />
                {row.matched_order_id && <div style={muted}>McLeod #{row.matched_order_id}</div>}</td>
              <td style={cell}><button style={button} disabled={matchWorking === row.id || working === row.id}
                onClick={() => void findOrder(row)}>{matchWorking === row.id ? "Searching…" : "Find order"}</button>
                {matches[row.id] && <div style={{ minWidth: 180, marginTop: 6 }}>
                  {matches[row.id].length === 0 ? <span>No matching order</span> :
                    matches[row.id].map((match) => <button key={match.orderId} style={{ ...button, display: "block", width: "100%", textAlign: "left", marginTop: 4 }}
                      disabled={working === row.id} onClick={() => void saveCustomer(row, match.customerName, match.orderId)}>
                      #{match.orderId} · {match.customerName || match.customerId}<small style={{ display: "block" }}>{match.value}</small>
                    </button>)}
                </div>}</td>
              <td style={cell}>{row.driver_name}<div style={muted}>{row.driver_phone}</div></td>
              <td style={cell}>{row.destination || "—"}</td>
              <td style={cell}><input key={row.updated_at} aria-label={`Warehouse location for ${row.driver_name}`}
                defaultValue={row.warehouse_location ?? ""} placeholder="Location"
                onBlur={(event) => void saveField(row, "warehouse_location", event.target.value)} style={sheetInput} /></td>
              <td style={cell}><input key={row.updated_at} aria-label={`Notes for ${row.driver_name}`}
                defaultValue={row.comment_1 ?? ""} placeholder="Notes"
                onBlur={(event) => void saveField(row, "comment_1", event.target.value)} style={sheetInput} /></td>
              <td style={cell}><strong style={{ color: "#67e8f9" }}>{LABEL[row.yard_status]}</strong>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                  <button disabled={working === row.id} style={primary} onClick={() => void transition(row, NEXT[row.yard_status].to)}>{NEXT[row.yard_status].label}</button>
                  {PREVIOUS[row.yard_status] && <button disabled={working === row.id} style={button} onClick={() => void transition(row, PREVIOUS[row.yard_status]!)}>Back</button>}
                  <button disabled={working === row.id} style={danger} onClick={() => void transition(row, "cancelled")}>Remove</button>
                </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </PlatformPanel>
    {!loadError && !loading && recent.length > 0 && <PlatformPanel style={{ marginTop: 16 }}>
      <h2 style={{ color: "#f8fafc", marginTop: 0 }}>Recent check-ins</h2>
      <p style={muted}>Completed and removed QR arrivals from the last 30 days. Older test check-ins may appear here.</p>
      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {recent.map((row) => <div key={row.id} style={card}>
          <strong style={{ color: "#f8fafc" }}>{row.driver_name} · {row.material_type} · {row.reference_number}</strong>
          <div style={muted}>{time(row.checked_in_at, site.terminal)} · {row.yard_status ?? "Before yard tracking"}</div>
          <Link href={`/warehouse/checkin/${row.id}`} style={{ color: "#67e8f9", fontSize: 13 }}>View details</Link>
        </div>)}
      </div>
    </PlatformPanel>}
  </main>;
}

function time(value: string, terminal: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: terminal === "HOU" ? "America/Chicago" : "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function elapsed(value: string, tick: number) {
  void tick;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "just arrived" : `${minutes} min since arrival`;
}
const button: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", cursor: "pointer", textDecoration: "none", fontWeight: 700 };
const primary: React.CSSProperties = { ...button, background: "#166534", borderColor: "#22c55e", color: "#dcfce7" };
const danger: React.CSSProperties = { ...button, color: "#fecaca", borderColor: "#7f1d1d" };
const muted: React.CSSProperties = { color: "#94a3b8", fontSize: 13, marginTop: 5 };
const card: React.CSSProperties = { border: "1px solid #334155", background: "#0f172a", borderRadius: 12, padding: 16 };
const heading: React.CSSProperties = { padding: "11px 8px", textAlign: "left", borderBottom: "2px solid #475569", whiteSpace: "nowrap", color: "#94a3b8" };
const cell: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #334155", verticalAlign: "top" };
const sheetInput: React.CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "8px", border: "1px solid #475569", borderRadius: 6, background: "#0b1220", color: "#f8fafc" };
