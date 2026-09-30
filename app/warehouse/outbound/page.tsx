"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import SourceLoadAlerts from "@/components/warehouse/SourceLoadAlerts";
import CutoffInput from "@/components/warehouse/CutoffInput";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { formatBookingDate } from "@/lib/warehouse/outbound/details";
import { deadlineMatches, groupBookings, type DashboardBooking, type DeadlineView, type BookingGroup } from "@/lib/warehouse/outbound/dashboard";

type Preview = { booking: { bookingNumber: string; customer: string; customerReference: string; containers: number | null;
  totalBales: number; erd: string | null; docCutoff: string | null; cutoff: string | null; vessel: string | null;
  sourceDates: { label: string; value: string }[]; detailNotes: string[]; warnings: string[];
  lines: { sourceRow: number; mark: string; shippingOrder: string; warehouse: string; bales: number; loadSource: "warehouse" | "source_load" }[] };
  mismatches: { row: number; warehouse: string }[] };
type Preferences = { warehouse: string; view: DeadlineView; group: BookingGroup; search: string; basis: "cutoff" | "erd" };
const defaultPreferences: Preferences = { warehouse: "all", view: "all", group: "schedule", search: "", basis: "cutoff" };
const storageKey = "scm.outbound.dashboard";
const sites = CHECKIN_SITES.filter((site) => site.materials.includes("cotton"));
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, borderWidth: 1, borderStyle: "solid", borderColor: "#475569", background: "#0f172a", color: "#f8fafc" };
const button: React.CSSProperties = { ...input, cursor: "pointer", fontWeight: 700 };
const active: React.CSSProperties = { borderColor: "#38bdf8", background: "rgba(14,165,233,.12)", color: "#e0f2fe" };
function dashboardUrl(preferences: Preferences) {
  const query = new URLSearchParams();
  if (preferences.warehouse === "all") query.set("warehouse", "all");
  else { const [terminal, siteCode] = preferences.warehouse.split(":"); query.set("terminal", terminal); query.set("siteCode", siteCode); }
  query.set("basis", preferences.basis); query.set("view", preferences.view); query.set("group", preferences.group);
  if (preferences.search) query.set("q", preferences.search);
  return `/warehouse/outbound?${query}`;
}
function validPreferences(raw: Partial<Preferences>): Preferences {
  return { warehouse: sites.some((site) => `${site.terminal}:${site.siteCode}` === raw.warehouse) ? raw.warehouse! : "all",
    view: ["today", "upcoming", "past"].includes(raw.view ?? "") ? raw.view! : "all",
    group: ["customer", "vessel", "erd"].includes(raw.group ?? "") ? raw.group! : "schedule", search: String(raw.search ?? ""), basis: raw.basis === "erd" ? "erd" : "cutoff" };
}

export default function CottonOutboundPage() {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [bookings, setBookings] = useState<DashboardBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [limitReached, setLimitReached] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [datesConfirmed, setDatesConfirmed] = useState(false);
  const [importDates, setImportDates] = useState({ erd: "", docCutoff: "", cutoff: "", vessel: "" });
  const site = sites.find((item) => `${item.terminal}:${item.siteCode}` === preferences.warehouse);
  useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search);
      let stored: Partial<Preferences> = {};
      try { stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { /* URL state still works if storage is disabled. */ }
      const hasUrlState = query.has("warehouse") || query.has("terminal") || query.has("siteCode") || query.has("view") || query.has("group") || query.has("q") || query.has("basis");
      setPreferences(validPreferences(hasUrlState ? {
        warehouse: query.get("warehouse") === "all" ? "all" : `${query.get("terminal")?.toUpperCase()}:${query.get("siteCode")}`,
        view: query.get("view") as DeadlineView, group: query.get("group") as BookingGroup, search: query.get("q") ?? "", basis: query.get("basis") === "erd" ? "erd" : "cutoff",
      } : stored));
      setReady(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => { window.removeEventListener("popstate", restore); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(null, "", dashboardUrl(preferences));
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Preserve selection in the URL. */ }
  }, [preferences, ready]);
  const list = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/warehouse/outbound/bookings", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBookings(result.bookings); setLimitReached(Boolean(result.limitReached));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load bookings"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void list();
    const timer = window.setInterval(() => void list(true), 30000);
    return () => window.clearInterval(timer);
  }, [list]);
  function selectWarehouse(warehouse: string) {
    setPreferences((current) => ({ ...current, warehouse })); setPreview(null); setFile(null); setError(""); setMessage("");
  }
  async function upload(event: FormEvent | React.MouseEvent, save: boolean) {
    event.preventDefault();
    if (!site || !file) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.set("file", file); body.set("terminal", site.terminal); body.set("siteCode", site.siteCode);
      if (save) { body.set("datesConfirmed", String(datesConfirmed)); Object.entries(importDates).forEach(([key, value]) => body.set(key, value)); }
      const response = await fetch(save ? "/api/warehouse/outbound/bookings" : "/api/warehouse/outbound/preview", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (save) window.location.assign(`/warehouse/outbound/${site.terminalSlug}/${site.siteCode}/${result.id}?returnTo=${encodeURIComponent(dashboardUrl(preferences))}`);
      else { setPreview(result); setDatesConfirmed(false);
        setImportDates({ erd: result.booking.erd ?? "", docCutoff: result.booking.docCutoff ?? "", cutoff: result.booking.cutoff ?? "", vessel: result.booking.vessel ?? "" }); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not process booking"); }
    finally { setWorking(false); }
  }
  const activeBookings = bookings.filter((item) => item.status === "draft");
  const warehouseBookings = activeBookings.filter((item) => !site || (item.terminal === site.terminal && item.site_code === site.siteCode));
  const stats = { all: warehouseBookings.length, today: warehouseBookings.filter((item) => deadlineMatches(item, "today", now, preferences.basis)).length,
    upcoming: warehouseBookings.filter((item) => deadlineMatches(item, "upcoming", now, preferences.basis)).length, past: warehouseBookings.filter((item) => deadlineMatches(item, "past", now, preferences.basis)).length };
  const search = preferences.search.trim().toLowerCase();
  const visible = warehouseBookings.filter((item) => deadlineMatches(item, preferences.view, now, preferences.basis) && (!search ||
    [item.booking_number, item.customer, item.customer_reference, item.vessel, item.site_name].some((value) => String(value ?? "").toLowerCase().includes(search))));
  const groups = groupBookings(visible, preferences.group, now);
  const returnTo = encodeURIComponent(dashboardUrl(preferences));

  return <main style={{ maxWidth: 1550, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title="Outbound bookings" subtitle="Warehouse load plans, receiving dates, and sailing cutoffs."
      actions={<><button type="button" style={button} aria-expanded={showImport} onClick={() => setShowImport((current) => !current)}>{showImport ? "Close import" : "+ Import booking"}</button>
        <Link href="/warehouse/inventory" style={button}>Inventory</Link></>} />

    <div aria-label="Choose warehouse" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 10, marginBottom: 20 }}>
      {[{ key: "all", name: "All warehouses", count: activeBookings.length }, ...sites.map((item) => ({ key: `${item.terminal}:${item.siteCode}`, name: item.siteName,
        count: activeBookings.filter((booking) => booking.terminal === item.terminal && booking.site_code === item.siteCode).length }))].map((item) =>
        <button key={item.key} type="button" disabled={working} aria-pressed={preferences.warehouse === item.key} style={{ ...button, ...(preferences.warehouse === item.key ? active : {}), textAlign: "left", padding: 16 }} onClick={() => selectWarehouse(item.key)}>
          <strong style={{ display: "block", marginBottom: 8 }}>{item.name}</strong><span style={{ color: "#94a3b8", fontSize: 12 }}>{loading ? "Loading…" : `${item.count} active booking${item.count === 1 ? "" : "s"}`}</span>
        </button>)}
    </div>

    <SourceLoadAlerts />
    <div aria-label="Filter booking dates" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {(["cutoff", "erd"] as const).map((basis) => <button key={basis} type="button" style={{ ...button, ...(preferences.basis === basis ? active : {}) }}
        aria-pressed={preferences.basis === basis} onClick={() => setPreferences((current) => ({ ...current, basis }))}>{basis === "erd" ? "Filter by ERD" : "Filter by cutoffs"}</button>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 12, marginBottom: 22 }}>
      {([{ key: "all", label: "Active bookings", tone: "#e2e8f0" }, { key: "today", label: preferences.basis === "erd" ? "ERD today" : "Cutoffs today", tone: "#38bdf8" },
        { key: "upcoming", label: "Next 7 days", tone: "#4ade80" }, { key: "past", label: preferences.basis === "erd" ? "Past ERD" : "Past cutoff", tone: "#fbbf24" }] as const).map((item) =>
        <button key={item.key} type="button" aria-pressed={preferences.view === item.key} style={{ ...button, ...(preferences.view === item.key ? active : {}), padding: 18, textAlign: "left" }}
          onClick={() => setPreferences((current) => ({ ...current, view: item.key }))}>
          <span style={{ display: "block", color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>{item.label}</span>
          <strong style={{ fontSize: 32, color: item.tone }}>{loading ? "—" : stats[item.key]}</strong>
        </button>)}
    </div>
    {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}
    {limitReached && <p style={{ color: "#fbbf24" }}>Showing the first 1,000 bookings ordered by cutoff.</p>}

    {showImport && <PlatformPanel><h2 style={{ marginTop: 0 }}>{site ? `Import to ${site.siteName}` : "Import a booking request"}</h2>
      {site ? <form onSubmit={(event) => void upload(event, false)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input key={preferences.warehouse} type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} />
        <button style={button} disabled={!file || working}>{working ? "Reading…" : "Review Bunge request"}</button>
      </form> : <p style={{ color: "#94a3b8" }}>Choose a warehouse card above to import its request.</p>}
      <p style={{ color: "#94a3b8", fontSize: 12 }}>Booking dates and vessel details import with the load plan. Saving creates a draft without changing inventory.</p>
    </PlatformPanel>}
    {preview && <PlatformPanel><h2>{preview.booking.bookingNumber} · {preview.booking.customer}</h2>
      <p>{preview.booking.lines.length} marks · {preview.booking.totalBales} bales · {preview.booking.containers ?? "—"} containers</p>
      <p>Confirm the sailing dates below, or correct them before importing. Load-by dates do not control the warehouse loading window.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginBottom: 12 }}>
        <label>ERD<input aria-label="Import ERD" type="date" style={input} value={importDates.erd} onChange={(event) => { setDatesConfirmed(false); setImportDates((current) => ({ ...current, erd: event.target.value })); }} /></label>
        <CutoffInput label="Doc cutoff" value={importDates.docCutoff} onChange={(value) => { setDatesConfirmed(false); setImportDates((current) => ({ ...current, docCutoff: value })); }} />
        <CutoffInput label="Cutoff" value={importDates.cutoff} onChange={(value) => { setDatesConfirmed(false); setImportDates((current) => ({ ...current, cutoff: value })); }} />
        <label>Vessel<input aria-label="Import vessel" maxLength={200} style={input} value={importDates.vessel} onChange={(event) => setImportDates((current) => ({ ...current, vessel: event.target.value }))} /></label>
      </div>
      {([['ERD', importDates.erd], ['Doc cutoff', importDates.docCutoff], ['Cutoff', importDates.cutoff]] as const).filter(([, value]) => value && value.slice(0, 10) < now.toLocaleDateString("en-CA", { timeZone: site?.terminal === "HOU" ? "America/Chicago" : "America/New_York" })).map(([label]) => <p key={label} style={{ color: "#fbbf24" }}>{label} is in the past. Confirm it if this is an older request, or enter the current date.</p>)}
      {importDates.erd && importDates.cutoff && importDates.erd > importDates.cutoff.slice(0, 10) && <p style={{ color: "#fbbf24" }}>ERD is after the cutoff. Review the loading window before confirming.</p>}
      <label style={{ display: "block", margin: "12px 0" }}><input type="checkbox" checked={datesConfirmed} onChange={(event) => setDatesConfirmed(event.target.checked)} /> I reviewed ERD, doc cutoff, and cutoff (including any dates still unknown).</label>
      {preview.booking.sourceDates?.length > 0 && <p style={{ color: "#94a3b8", fontSize: 12 }}>Source dates: {preview.booking.sourceDates.map(({ label, value }) => `${label}: ${formatBookingDate(value, value.includes("T"))}`).join(" · ")}</p>}
      {preview.booking.detailNotes?.map((note) => <p key={note} style={{ color: "#fbbf24" }}>{note}</p>)}
      {preview.booking.lines.some((line) => line.loadSource === "source_load") && <p style={{ color: "#7dd3fc" }}>Other-location marks will be saved as Source loads for direct pickup in a container. They are excluded from missing warehouse marks and can be converted later.</p>}
      {preview.booking.warnings.map((warning) => <p key={warning} style={{ color: "#fbbf24" }}>{warning}</p>)}
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}><thead><tr>{["Mark", "Bales", "S.O.", "Warehouse", "Load plan"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {[...preview.booking.lines].sort((a, b) => Number(a.loadSource === "source_load") - Number(b.loadSource === "source_load")).map((line) => <tr key={line.sourceRow}><td>{line.mark}</td><td>{line.bales}</td><td>{line.shippingOrder}</td><td>{line.warehouse}</td><td>{line.loadSource === "source_load" ? "Source load" : "Warehouse load"}</td></tr>)}
      </tbody></table></div>
      <button style={{ ...button, marginTop: 14 }} disabled={working || !datesConfirmed || !!preview.booking.warnings.length} onClick={(event) => void upload(event, true)}>Save draft booking</button>
    </PlatformPanel>}

    <PlatformPanel><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
      <div><strong style={{ fontSize: 20 }}>{site?.siteName ?? "All warehouses"}</strong><span style={{ marginLeft: 10, color: "#94a3b8", fontSize: 12 }}>{visible.length} booking{visible.length === 1 ? "" : "s"}</span></div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Group bookings">
        {([{ key: "schedule", label: "By cutoff" }, { key: "erd", label: "By ERD" }, { key: "customer", label: "By customer" }, { key: "vessel", label: "By vessel" }] as const).map((item) =>
          <button key={item.key} type="button" aria-pressed={preferences.group === item.key} style={{ ...button, ...(preferences.group === item.key ? active : {}) }} onClick={() => setPreferences((current) => ({ ...current, group: item.key }))}>{item.label}</button>)}
      </div>
      <input aria-label="Search outbound bookings" placeholder="Search booking, customer, or vessel" value={preferences.search} style={{ ...input, flex: "1 1 280px", maxWidth: 380 }}
        onChange={(event) => setPreferences((current) => ({ ...current, search: event.target.value }))} />
    </div></PlatformPanel>
    {loading || !ready ? <p>Loading outbound bookings…</p> : groups.length === 0 ? <PlatformPanel><p style={{ margin: 0 }}>{bookings.length ? "No bookings match this view." : "No bookings imported yet. Choose a warehouse and import a request to start."}</p>
      {bookings.length > 0 && <button style={{ ...button, marginTop: 12 }} onClick={() => setPreferences((current) => ({ ...current, view: "all", search: "" }))}>Show all bookings at this warehouse</button>}</PlatformPanel> :
      groups.map(([name, items]) => <section key={name} style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}><h2 style={{ fontSize: 19, margin: 0 }}>{name}</h2>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>{items.length} bookings · {items.reduce((sum, item) => sum + item.requested_bales, 0).toLocaleString()} bales</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
          {items.map((item) => <Link key={item.id} href={`/warehouse/outbound/${item.terminal.toLowerCase()}/${item.site_code}/${item.id}?returnTo=${returnTo}`}
            style={{ padding: 20, borderRadius: 14, border: "1px solid #334155", background: "rgba(15,23,42,.75)", display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><strong style={{ fontSize: 21, color: "#f8fafc" }}>{item.booking_number}</strong>
              <span style={{ fontSize: 11, color: "#7dd3fc", whiteSpace: "nowrap" }}>{item.terminal} {item.site_code}</span></div>
            <p style={{ color: "#cbd5e1", fontSize: 13, margin: "8px 0" }}>{item.customer}</p>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 18px", minHeight: 16 }}>{item.vessel || "Vessel needed"}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, borderTop: "1px solid #334155", paddingTop: 14 }}>
              <DateCell label="ERD" value={item.erd} /><DateCell label="Doc cutoff" value={item.doc_cutoff} hasTime={item.doc_cutoff_has_time} today={deadlineMatches({ ...item, cutoff: null }, "today", now)} />
              <DateCell label="Cutoff" value={item.cutoff} hasTime={item.cutoff_has_time} today={deadlineMatches({ ...item, doc_cutoff: null }, "today", now)} />
            </div><div style={{ marginTop: 14, fontSize: 12 }}>
              <strong title="Active warehouse marks whose physical bale count is below the requested count. Checked-in loads remain missing until receiving is completed; source loads and held marks are excluded." style={{ color: item.missing_marks ? "#fca5a5" : "#86efac" }}>{item.missing_marks ?? 0} missing mark{item.missing_marks === 1 ? "" : "s"}</strong>
              {!!item.source_loads && <span style={{ marginLeft: 12, color: "#7dd3fc" }}>{item.source_loads} source loads</span>}
              {!!item.held_marks && <span style={{ marginLeft: 12, color: "#fbbf24" }}>{item.held_marks} on hold</span>}
              {!!item.source_arrivals && <p style={{ color: "#fde68a" }}>{item.source_arrivals} source load{item.source_arrivals === 1 ? "" : "s"} arrived — review needed</p>}
            </div><div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 12, marginTop: 18 }}>
              <span>{item.requested_bales.toLocaleString()} bales · {item.planned_containers ?? "—"} containers</span><span style={{ color: "#7dd3fc" }}>Open booking →</span></div>
          </Link>)}
        </div>
      </section>)}
  </main>;
}
function DateCell({ label, value, hasTime = false, today = false }: { label: string; value: string | null; hasTime?: boolean; today?: boolean }) {
  return <div><span style={{ display: "block", color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>{label}</span>
    <strong style={{ fontSize: 12, color: today ? "#38bdf8" : "#e2e8f0", display: "block" }}>{formatBookingDate(value, hasTime)}</strong>
    {today && <span style={{ color: "#38bdf8", fontSize: 10 }}>Today</span>}</div>;
}
