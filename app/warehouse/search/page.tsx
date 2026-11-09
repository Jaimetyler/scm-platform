"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { useWarehouseWorkspace } from "@/components/warehouse/WarehouseWorkspace";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { formatBookingDate } from "@/lib/warehouse/outbound/details";
import { locationLabel } from "@/lib/warehouse/navigation";
type Result = { id: string; terminal: string; site_code: string; site_name: string; title: string; subtitle: string; status: string; quantity?: number; kind?: string; date?: string; marks?: string[]; containers?: string[] };
type Results = Record<"inventory" | "bookings" | "checkins" | "containerArrivals", Result[]>;
const categories: [keyof Results, string][] = [["inventory", "Inventory / marks"], ["bookings", "Outbound bookings / containers"], ["checkins", "Check-ins / history"], ["containerArrivals", "Container arrivals"]];
export default function WarehouseSearchPage() {
  const query = useSearchParams().get("q")?.trim() || "";
  const { location, ready } = useWarehouseWorkspace();
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null); setError(""); setLoading(false);
    if (!ready || query.length < 2) return;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ q: query });
    if (location.terminal !== "all") params.set("terminal", location.terminal);
    if (location.siteCode !== "all") params.set("siteCode", location.siteCode);
    void (async () => {
      try {
        const response = await fetch(`/api/warehouse/search?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw Error(result.error || "Could not search this warehouse.");
        if (!controller.signal.aborted) setData(result.results);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not search this warehouse."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [ready, query, location.terminal, location.siteCode]);
  return <main style={{ maxWidth: 1500, margin: "0 auto" }}>
    <PlatformPageHeader title="Warehouse search" subtitle={`${locationLabel(location)} · Inventory, bookings, equipment, arrivals and history`} />
    {query.length < 2 ? <p>Use the search above. Enter at least two characters.</p> : <p>Results for <strong>“{query}”</strong></p>}
    {loading && <p role="status">Searching this warehouse…</p>}{error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
    {data && categories.map(([key, label]) => <PlatformPanel key={key} style={{ padding: 20, marginBottom: 18 }}>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>{label} <span style={{ color: "#94a3b8", fontSize: 14 }}>· {data[key].length > 25 ? "25+" : data[key].length}</span></h2>
      {!data[key].length ? <p style={{ color: "#94a3b8" }}>No matches in this location.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 12 }}>
        {data[key].slice(0, 25).map(row => <ResultCard key={row.id} row={row} category={key} />)}
      </div>}
      {data[key].length > 25 && <p style={{ color: "#fde68a" }}>Showing the first 25 matches. Refine the search to find a specific record.</p>}
    </PlatformPanel>)}
  </main>;
}
function ResultCard({ row, category }: { row: Result; category: keyof Results }) {
  const site = getCheckinSite(row.terminal, row.site_code);
  const path = site ? `${site.terminalSlug}/${site.siteCode}` : null;
  const active = ["waiting", "called", "in_door", "working"].includes(row.status);
  const href = !path ? null : category === "bookings" ? `/warehouse/outbound/${path}/${row.id}`
    : category === "inventory" ? `/warehouse/inventory/${path}?search=${encodeURIComponent(row.title)}`
    : category === "containerArrivals" ? `/warehouse/gate/${path}/containers`
    : active ? `/warehouse/gate/${path}/line?arrival=${row.id}` : `/warehouse/gate/${path}/history?search=${encodeURIComponent(row.title)}`;
  const date = !row.date ? "" : category === "bookings" ? formatBookingDate(row.date, row.date.includes("T")) : /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : new Intl.DateTimeFormat("en-US", { timeZone: row.terminal === "SAV" ? "America/New_York" : "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(row.date));
  return <article style={{ border: "1px solid #30465c", borderRadius: 10, padding: 14, background: "#102137" }}>
    <strong style={{ fontSize: 17 }}>{row.title}</strong><div style={{ color: "#67e8f9", marginTop: 4 }}>{row.terminal} · {site?.displayCode || row.site_code} · {row.status?.replaceAll("_", " ")}</div>
    <p style={{ color: "#b7cce0", overflowWrap: "anywhere", fontSize: 13 }}>{row.subtitle}</p>
    {row.quantity != null && <div>{row.quantity} bales{row.kind === "break" ? " · Break mark" : ""}</div>}
    {row.marks?.length > 0 && <div style={{ fontSize: 13 }}>Marks: {row.marks.join(", ")}</div>}
    {row.containers?.length > 0 && <div style={{ fontSize: 13 }}>Equipment: {row.containers.join(", ")}</div>}
    {date && <small style={{ display: "block", color: "#94a3b8", marginTop: 6 }}>{date}</small>}
    {href && <Link href={href} style={{ display: "inline-block", color: "#67e8f9", marginTop: 12 }}>Open {category === "inventory" ? "inventory" : category === "bookings" ? "booking" : category === "containerArrivals" ? "container sheet" : active ? "arrival" : "history"} →</Link>}
  </article>;
}
