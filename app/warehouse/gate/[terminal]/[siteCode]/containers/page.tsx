"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type QueueRow = { id: string; checked_in_at: string; driver_name: string; queue_status: string };

export default function ContainerLinePage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workingId, setWorkingId] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!site) return;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode });
      const response = await fetch(`/api/warehouse/container-queue?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the container line");
      setRows(result.rows ?? []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the container line");
    } finally {
      setLoading(false);
    }
  }, [site]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 7000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function update(id: string, action: "complete" | "cancel") {
    if (action === "cancel" && !window.confirm("Remove this driver from the container line?")) return;
    setWorkingId(id);
    setError("");
    try {
      const response = await fetch("/api/warehouse/container-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not update the line");
      setRows((current) => current.filter((row) => row.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the line");
    } finally {
      setWorkingId("");
    }
  }

  if (!site) return <main><PlatformPageHeader title="Container Line Not Found" /></main>;

  return <main style={{ maxWidth: 1100, margin: "0 auto" }}>
    <PlatformPageHeader
      title={`${site.siteName} Container Line`}
      subtitle="Drivers appear in arrival order. Complete a driver when they leave the line."
      actions={<>
        <Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={linkStyle}>Domestic Check-In</Link>
        <Link href="/warehouse/gate" style={linkStyle}>QR Setup</Link>
      </>}
    />
    {error ? <div style={errorStyle}>{error}</div> : null}
    <PlatformPanel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <strong style={{ color: "#f8fafc", fontSize: 20 }}>{rows.length} waiting</strong>
        <button onClick={() => void load()} style={linkStyle}>Refresh</button>
      </div>
      {loading ? <p style={mutedStyle}>Loading line…</p> : rows.length === 0 ?
        <div style={{ padding: "50px 20px", textAlign: "center", color: "#94a3b8" }}>No container drivers are waiting.</div> :
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, index) => <div key={row.id} style={rowStyle}>
            <div style={numberStyle}>#{index + 1}</div>
            <div style={{ flex: "1 1 240px" }}>
              <div style={{ color: "#f8fafc", fontSize: 19, fontWeight: 900 }}>{row.driver_name}</div>
              <div style={mutedStyle}>Checked in {formatTime(row.checked_in_at)} · {waitingTime(row.checked_in_at)}</div>
            </div>
            <button disabled={workingId === row.id} onClick={() => void update(row.id, "complete")} style={completeStyle}>Complete</button>
            <button disabled={workingId === row.id} onClick={() => void update(row.id, "cancel")} style={removeStyle}>Remove</button>
          </div>)}
        </div>}
    </PlatformPanel>
  </main>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function waitingTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just arrived";
  if (minutes === 1) return "waiting 1 minute";
  return `waiting ${minutes} minutes`;
}

const linkStyle: React.CSSProperties = { padding: "10px 13px", borderRadius: 9, border: "1px solid rgba(148,163,184,.28)", background: "#0f172a", color: "#e2e8f0", fontWeight: 800, cursor: "pointer", textDecoration: "none" };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, padding: 15, borderRadius: 12, border: "1px solid rgba(148,163,184,.18)", background: "rgba(15,23,42,.7)" };
const numberStyle: React.CSSProperties = { width: 62, color: "#67e8f9", fontSize: 26, fontWeight: 950 };
const mutedStyle: React.CSSProperties = { color: "#94a3b8", fontSize: 13, marginTop: 4 };
const completeStyle: React.CSSProperties = { ...linkStyle, background: "#166534", borderColor: "#22c55e", color: "#dcfce7" };
const removeStyle: React.CSSProperties = { ...linkStyle, background: "rgba(127,29,29,.35)", borderColor: "rgba(248,113,113,.4)", color: "#fecaca" };
const errorStyle: React.CSSProperties = { padding: 12, borderRadius: 10, color: "#fecaca", background: "rgba(127,29,29,.34)", marginBottom: 16 };
