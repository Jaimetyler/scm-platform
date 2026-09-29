"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import DomesticFreightNav from "@/components/warehouse/DomesticFreightNav";
import PaperworkPhotoLink from "@/components/warehouse/PaperworkPhotoLink";
import "@/components/warehouse/domestic-tables.css";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type Row = {
  id: string; checked_in_at: string; yard_completed_at: string | null; yard_status: string;
  driver_name: string | null; driver_phone: string | null; movement_direction: string | null;
  material_type: string; reference_number: string | null; mark: string | null;
  shipper: string | null; matched_order_id: string | null; draft_status: string;
  destination: string | null; checkin_source: string | null;
  has_bol_photo: boolean;
};

export default function DomesticHistoryPage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState({ search: "", from: "", through: "", status: "all" });
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useCallback((pageNumber: number, exportFile = false) => {
    if (!site) return "";
    const params = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode, page: String(pageNumber), status: filters.status });
    if (filters.search) params.set("search", filters.search);
    if (filters.from) params.set("from", filters.from);
    if (filters.through) params.set("through", filters.through);
    if (exportFile) params.set("export", "xlsx");
    return `/api/warehouse/domestic-history?${params}`;
  }, [site, filters]);

  useEffect(() => {
    if (!site) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(query(page), { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not load history");
        if (!cancelled) { setRows(result.rows); setHasMore(result.hasMore); setError(""); }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load history"); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [site, query, page]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(0);
    setFilters({ search: search.trim(), from, through, status });
  }
  if (!site) return <main><PlatformPageHeader title="Domestic History Not Found" /></main>;
  const time = (value: string | null) => value ? new Date(value).toLocaleString("en-US", {
    timeZone: site.terminal === "HOU" ? "America/Chicago" : "America/New_York",
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }) : "—";
  return <main style={{ width: "100%", padding: "0 12px", boxSizing: "border-box" }}>
    <PlatformPageHeader title={`${site.siteName} Domestic History`}
      subtitle="Search completed and removed cotton, lumber, and other freight check-ins."
      actions={<Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/line`} style={button}>Domestic Line</Link>} />
    <DomesticFreightNav terminalSlug={site.terminalSlug} siteCode={site.siteCode} current="history" />
    <PlatformPanel>
      <form onSubmit={apply} style={{ display: "flex", gap: 12, padding: "14px 16px", borderRadius: 10, background: "rgba(30,41,59,.36)", border: "1px solid rgba(148,163,184,.12)", flexWrap: "wrap", alignItems: "end", marginBottom: 18 }}>
        <label style={label}>Search driver, reference, mark, customer, or McLeod ID
          <input value={search} onChange={(event) => setSearch(event.target.value)} style={input} /></label>
        <label style={label}>From arrival date<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={input} /></label>
        <label style={label}>Through arrival date<input type="date" value={through} onChange={(event) => setThrough(event.target.value)} style={input} /></label>
        <label style={label}>Status<select value={status} onChange={(event) => setStatus(event.target.value)} style={input}>
          <option value="all">Completed + removed</option><option value="completed">Completed</option><option value="cancelled">Removed</option>
        </select></label>
        <button type="submit" style={primary}>Search</button>
        <a href={query(0, true)} style={button}>Export matching rows to Excel</a>
      </form>
      {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
      {loading ? <p>Loading history…</p> : rows.length === 0 ? <p>No matching check-ins.</p> :
        <div style={{ overflowX: "auto" }}><table className="domestic-table" style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse", color: "#e2e8f0" }}>
          <thead><tr>{["Arrived", "Checked out", "Status", "Material", "Move", "Driver / source", "Reference / mark", "Customer", "SCM order / processing"].map((name) =>
            <th key={name} style={heading}>{name}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td style={cell}>{time(row.checked_in_at)}</td><td style={cell}>{time(row.yard_completed_at)}</td>
            <td style={cell}><span style={statusStyle(row.yard_status)}>{row.yard_status === "cancelled" ? "Removed" : "Completed"}</span></td><td style={cell}>{row.material_type}</td>
            <td style={cell}>{row.movement_direction || "—"}</td><td style={cell}>{row.driver_name || "Staff entry"}<span className="row-secondary">{row.checkin_source === "driver_qr" ? "Driver QR" : "Staff"}</span></td>
            <td style={cell}>{row.reference_number || row.mark || "—"}
              {row.has_bol_photo && <div style={{ marginTop: 5 }}><PaperworkPhotoLink checkinId={row.id} /></div>}</td>
            <td style={cell}>{row.shipper || "—"}</td>
            <td style={cell}>{row.matched_order_id ? <>#{row.matched_order_id}<span className="row-secondary">{row.draft_status === "processed" ? "Processed in McLeod" : "Checked in"}</span></> : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button disabled={page === 0 || loading} style={button} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button>
        <span>Page {page + 1}</span>
        <button disabled={!hasMore || loading} style={button} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>
    </PlatformPanel>
  </main>;
}

const statusStyle = (status: string): React.CSSProperties => ({ display: "inline-block", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: status === "cancelled" ? "rgba(148,163,184,.13)" : "rgba(34,197,94,.12)", color: status === "cancelled" ? "#cbd5e1" : "#86efac" });
const button: React.CSSProperties = { padding: "9px 12px", border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", borderRadius: 7, textDecoration: "none", cursor: "pointer" };
const primary: React.CSSProperties = { ...button, background: "#0e7490", borderColor: "#0e7490", color: "white" };
const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#cbd5e1" };
const input: React.CSSProperties = { padding: "9px", border: "1px solid #475569", background: "#0b1220", color: "white", borderRadius: 6 };
const heading: React.CSSProperties = { padding: "12px 10px", textAlign: "left", borderBottom: "1px solid #475569", whiteSpace: "nowrap", color: "#a8b8cc", fontSize: 12 };
const cell: React.CSSProperties = { padding: "14px 10px", borderBottom: "1px solid #334155", verticalAlign: "middle" };
