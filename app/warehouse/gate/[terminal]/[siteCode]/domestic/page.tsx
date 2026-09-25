"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type Status = "waiting" | "called" | "in_door" | "working";
type Row = {
  id: string; checked_in_at: string; driver_name: string; driver_phone: string;
  movement_direction: string; material_type: string; reference_number: string;
  destination: string | null; mark: string | null; bol_bc: number | null;
  draft_status: string; has_bol_photo: boolean; yard_status: Status;
  yard_called_at: string | null; yard_in_door_at: string | null;
  yard_work_started_at: string | null;
};
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
  const [working, setWorking] = useState("");
  const [tick, setTick] = useState(0);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load arrivals");
    } finally { setLoading(false); }
  }, [site]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(true); setTick((value) => value + 1); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function transition(row: Row, to: string) {
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

  if (!site) return <main><PlatformPageHeader title="Domestic Queue Not Found" /></main>;
  const counts = Object.keys(LABEL).map((status) => `${rows.filter((row) => row.yard_status === status).length} ${LABEL[status as Status].toLowerCase()}`);
  return <main style={{ maxWidth: 1160, margin: "0 auto" }}>
    <PlatformPageHeader title={`${site.siteName} Domestic Freight`}
      subtitle="QR arrivals in arrival order. Move each truck through the yard as work progresses."
      actions={<><Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={button}>Cotton grid</Link>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/containers`} style={button}>Container line</Link></>} />
    {error && <div role="alert" style={{ color: "#fecaca", marginBottom: 14 }}>{error}</div>}
    <PlatformPanel>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <strong style={{ color: "#f8fafc" }}>{counts.join(" · ")}</strong>
        <button style={button} onClick={() => void load()}>Refresh</button>
      </div>
      {loading ? <p style={muted}>Loading arrivals…</p> : rows.length === 0 ?
        <p style={muted}>No active domestic freight arrivals.</p> :
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((row, index) => <div key={row.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div><strong style={{ color: "#f8fafc", fontSize: 19 }}>#{index + 1} · {row.driver_name}</strong>
                <div style={muted}>{row.movement_direction} · {row.material_type} · Ref {row.reference_number}</div>
                {row.destination && <div style={muted}>Destination: {row.destination}</div>}
                {row.mark && <div style={muted}>Mark: {row.mark}{row.bol_bc ? ` · BOL bales: ${row.bol_bc}` : ""}</div>}
                <div style={muted}>Arrived {time(row.checked_in_at, site.terminal)} · {elapsed(row.checked_in_at, tick)} · {row.driver_phone}</div>
                <Link href={`/warehouse/checkin/${row.id}`} style={{ color: "#67e8f9", fontSize: 13 }}>Details{row.has_bol_photo ? " & paperwork" : ""}</Link>
              </div>
              <strong style={{ color: "#67e8f9" }}>{LABEL[row.yard_status]}</strong>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button disabled={working === row.id} style={primary} onClick={() => void transition(row, NEXT[row.yard_status].to)}>{NEXT[row.yard_status].label}</button>
              {PREVIOUS[row.yard_status] && <button disabled={working === row.id} style={button} onClick={() => void transition(row, PREVIOUS[row.yard_status]!)}>Move back</button>}
              <button disabled={working === row.id} style={danger} onClick={() => void transition(row, "cancelled")}>Remove</button>
            </div>
          </div>)}
        </div>}
    </PlatformPanel>
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
