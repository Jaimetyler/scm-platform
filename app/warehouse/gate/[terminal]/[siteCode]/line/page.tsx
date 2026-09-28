"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type Status = "waiting" | "called" | "in_door" | "working";
type Arrival = {
  id: string; checked_in_at: string; driver_name: string | null; movement_direction: string | null;
  material_type: string; reference_number: string | null; mark: string | null;
  shipper: string | null; yard_status: Status | "completed" | "cancelled" | null;
};
const LABEL: Record<Status, string> = {
  waiting: "Waiting", called: "Called", in_door: "In door", working: "Loading / Unloading",
};
const NEXT: Record<Status, { to: string; label: string }> = {
  waiting: { to: "called", label: "Call driver" },
  called: { to: "in_door", label: "In door" },
  in_door: { to: "working", label: "Start work" },
  working: { to: "completed", label: "Complete" },
};
const PREVIOUS: Partial<Record<Status, string>> = { called: "waiting", in_door: "called", working: "in_door" };

export default function DomesticLinePage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const [rows, setRows] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    if (!site) return;
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode, view: "line" });
      const response = await fetch(`/api/warehouse/domestic-queue?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the domestic line");
      setRows(result.rows);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the domestic line"); }
    finally { setLoading(false); }
  }, [site]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!working) void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load, working]);

  async function move(row: Arrival & { yard_status: Status }, to: string) {
    if (!site || working) return;
    if (to === "cancelled" && !window.confirm(`Remove ${row.driver_name || row.reference_number || row.mark} from the line?`)) return;
    setWorking(row.id);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, from: row.yard_status, to, terminal: site.terminal, siteCode: site.siteCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not update this arrival");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this arrival"); }
    finally { setWorking(""); }
  }

  if (!site) return <main><PlatformPageHeader title="Domestic Line Not Found" /></main>;
  const active = rows.filter((row): row is Arrival & { yard_status: Status } =>
    row.yard_status === "waiting" || row.yard_status === "called" || row.yard_status === "in_door" || row.yard_status === "working")
    .sort((a, b) => new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime() || a.id.localeCompare(b.id));
  const waiting = active.filter((row) => row.yard_status === "waiting").length;
  const nextWaitingId = active.find((row) => row.yard_status === "waiting")?.id;
  const time = (value: string) => new Date(value).toLocaleTimeString("en-US", {
    timeZone: site.terminal === "HOU" ? "America/Chicago" : "America/New_York", hour: "numeric", minute: "2-digit",
  });
  return <main style={{ width: "100%", padding: "0 12px", boxSizing: "border-box" }}>
    <PlatformPageHeader title={`${site.siteName} Domestic Line`}
      subtitle="Cotton, lumber, and other freight in one arrival order. Yard progress is separate from McLeod processing."
      actions={<Link href="/warehouse/gate" style={button}>All gate sites</Link>} />
    <nav aria-label="Freight views" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <span aria-current="page" style={primary}>Domestic Line</span>
      <Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={button}>Cotton grid</Link>
      <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/domestic`} style={button}>Lumber & Other grid</Link>
    </nav>
    {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
    <PlatformPanel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <strong>{waiting} waiting · {active.length} active</strong>
        <button style={button} onClick={() => void load()}>Refresh</button>
      </div>
      {loading ? <p>Loading arrivals…</p> : active.length === 0 ? <p>No active domestic arrivals.</p> :
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse", color: "#e2e8f0" }}>
          <thead><tr>{["#", "Arrived", "Freight", "Move", "Driver", "Reference / mark", "Customer", "Yard status", "Action"].map((name) =>
            <th key={name} style={heading}>{name}</th>)}</tr></thead>
          <tbody>{active.map((row, index) => <tr key={row.id} style={{ background: row.id === nextWaitingId ? "rgba(34,211,238,.12)" : undefined }}>
            <td style={cell}>{index + 1}</td>
            <td style={cell}>{time(row.checked_in_at)}</td>
            <td style={cell}>{row.material_type === "cotton" ? "Cotton" : row.material_type === "lumber" ? "Lumber" : "Other"}</td>
            <td style={cell}>{row.movement_direction || "—"}</td>
            <td style={cell}>{row.driver_name || "Staff entry"}</td>
            <td style={cell}>{row.reference_number || row.mark || "—"}</td>
            <td style={cell}>{row.shipper || "—"}</td>
            <td style={cell}>{LABEL[row.yard_status]}{row.id === nextWaitingId ? <div style={{ color: "#67e8f9", fontSize: 12 }}>Next to call</div> : null}</td>
            <td style={cell}><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <button disabled={Boolean(working)} style={primary} onClick={() => void move(row, NEXT[row.yard_status].to)}>{NEXT[row.yard_status].label}</button>
              {PREVIOUS[row.yard_status] && <button disabled={Boolean(working)} style={button} onClick={() => void move(row, PREVIOUS[row.yard_status]!)}>Back</button>}
              <button disabled={Boolean(working)} style={button} onClick={() => void move(row, "cancelled")}>Remove</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>}
    </PlatformPanel>
  </main>;
}

const button: React.CSSProperties = { padding: "8px 11px", border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", borderRadius: 7, textDecoration: "none", cursor: "pointer" };
const primary: React.CSSProperties = { ...button, background: "#0e7490", borderColor: "#0e7490", color: "#fff" };
const heading: React.CSSProperties = { padding: "10px 8px", textAlign: "left", borderBottom: "2px solid #475569", whiteSpace: "nowrap" };
const cell: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #334155", verticalAlign: "top" };
