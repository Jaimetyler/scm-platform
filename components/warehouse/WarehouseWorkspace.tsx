"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { CHECKIN_SITES, getCheckinSite, TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import { ALL_LOCATIONS, LOCATION_KEY, CHECKIN_VIEW_KEY, validLocation, routeLocation, sectionForPath, checkinViewForPath,
  availableCheckinViews, workspaceHref, locationLabel, locationQuery, safeOutboundReturn, type WarehouseLocation, type WarehouseSection, type CheckinView } from "@/lib/warehouse/navigation";
import { WarehouseScrollMemory } from "./useWarehouseViewState";
import "./warehouse-workspace.css";
import { useStaff } from "@/components/auth/StaffSession";

const Context = createContext<{ location: WarehouseLocation; ready: boolean; href: (section: WarehouseSection) => string }>({
  location: ALL_LOCATIONS, ready: false, href: (section) => workspaceHref(section, ALL_LOCATIONS),
});
export const useWarehouseWorkspace = () => useContext(Context);

export default function WarehouseWorkspace({ children }: { children: ReactNode }) {
  const staff = useStaff();
  const path = usePathname();
  const router = useRouter();
  const query = useSearchParams();
  const queryString = query.toString();
  const enabled = path === "/warehouse" || path.startsWith("/warehouse/") || path === "/inbound" || path.startsWith("/inbound/");
  const visible = enabled && !path.endsWith("/print");
  const [remembered, setRemembered] = useState(ALL_LOCATIONS);
  const [checkinView, setCheckinView] = useState<CheckinView>("cotton");
  const [outboundFilters, setOutboundFilters] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setRemembered(validLocation(JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "null")));
      const view = localStorage.getItem(CHECKIN_VIEW_KEY);
      if (["cotton", "line", "domestic", "containers"].includes(view)) setCheckinView(view as CheckinView);
      const prefs = JSON.parse(localStorage.getItem("scm.outbound.dashboard") ?? "{}");
      const filters = new URLSearchParams();
      for (const key of ["basis", "view", "group"]) if (typeof prefs[key] === "string") filters.set(key, prefs[key]);
      if (typeof prefs.search === "string") filters.set("q", prefs.search);
      setOutboundFilters(filters.toString());
    } catch { /* Stored navigation is optional. */ }
    setReady(true);
  }, []);
  const explicit = routeLocation(path, new URLSearchParams(queryString));
  const preferred = explicit ?? remembered;
  const location: WarehouseLocation = staff?.role === "operator"
    ? { terminal: staff.terminal!, siteCode: preferred.terminal === staff.terminal ? preferred.siteCode : "all" }
    : preferred;
  const section = sectionForPath(path);
  const view = checkinViewForPath(path) ?? checkinView;
  useEffect(() => {
    if (!ready || !visible) return;
    if (explicit) {
      setRemembered((current) => current.terminal === explicit.terminal && current.siteCode === explicit.siteCode ? current : explicit);
      try { localStorage.setItem(LOCATION_KEY, JSON.stringify(explicit)); } catch { /* Optional. */ }
    }
    const activeView = checkinViewForPath(path);
    if (activeView) {
      setCheckinView(activeView);
      try { localStorage.setItem(CHECKIN_VIEW_KEY, activeView); } catch { /* Optional. */ }
    }
    if (path === "/warehouse/outbound") setOutboundFilters(queryString);
  }, [path, queryString, ready, visible, explicit?.terminal, explicit?.siteCode]);
  const filters = path === "/warehouse/outbound" ? queryString : outboundFilters;
  const href = (target: WarehouseSection) => workspaceHref(target, location, view, filters);
  const returnTo = path.startsWith("/warehouse/outbound/") ? safeOutboundReturn(query.get("returnTo")) : null;
  const site = getCheckinSite(location.terminal, location.siteCode);
  const navigation: [WarehouseSection, string][] = [["overview", "Operations"], ["checkins", "Check-In"], ["outbound", "Outbound Bookings"], ["inventory", "Inventory"], ["history", "History"]];
  const locationHref = (next: WarehouseLocation) => workspaceHref(section, next, view, filters);
  return <Context.Provider value={{ location, ready, href }}>
    {visible && <header className="warehouse-workspace" aria-label="Warehouse workspace">
      <div className="warehouse-brand-row">
        <Link href={href("overview")} className="warehouse-brand">SCM <span>Warehouse</span></Link>
        <div className="warehouse-location-options">
          <select aria-label="Terminal" value={location.terminal} onChange={event => {
            const terminal = event.target.value as WarehouseLocation["terminal"];
            router.push(locationHref({ terminal, siteCode: "all" }));
          }}>
            {staff?.role !== "operator" && <option value="all">All locations</option>}
            {Object.entries(TERMINAL_NAMES)
              .filter(([terminal]) => staff?.role !== "operator" || terminal === staff.terminal)
              .map(([terminal, label]) => <option key={terminal} value={terminal}>{label}</option>)}
          </select>
          {location.terminal !== "all" && <select aria-label="Warehouse site" value={location.siteCode}
            onChange={event => router.push(locationHref({ ...location, siteCode: event.target.value }))}>
            <option value="all">All sites</option>
            {CHECKIN_SITES.filter(item => item.terminal === location.terminal)
              .sort((a, b) => (a.displayCode ?? a.siteCode).localeCompare(b.displayCode ?? b.siteCode, undefined, { numeric: true }))
              .map(item => <option key={item.siteCode} value={item.siteCode}>{item.displayCode ?? item.siteCode}</option>)}
          </select>}
        </div>
        <div className="warehouse-utilities">
          <Link href={href("rates")}>Rates</Link>
          {staff?.role === "admin" && <>
            <Link href={href("carriers")} aria-current={section === "carriers" ? "page" : undefined}>Carriers</Link>
            <Link href="/warehouse/gate">QR Set up</Link>
          </>}
          <details className="warehouse-search-menu" onToggle={event => {
            if (event.currentTarget.open) event.currentTarget.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
          }} onKeyDown={event => {
            if (event.key !== "Escape" || !event.currentTarget.open) return;
            event.preventDefault();
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }} key={`${path}:${location.terminal}:${location.siteCode}:${query.get("q") ?? ""}`}>
            <summary>Search</summary>
            <form className="warehouse-global-search" action="/warehouse/search" role="search">
                {location.terminal !== "all" && <input type="hidden" name="terminal" value={location.terminal} />}
                {location.siteCode !== "all" ? <input type="hidden" name="siteCode" value={location.siteCode} /> : <input type="hidden" name="warehouse" value="all" />}
                <input key={`${location.terminal}:${location.siteCode}:${query.get("q") || ""}`} name="q" type="search" minLength={2} maxLength={100} required
                  defaultValue={path === "/warehouse/search" ? query.get("q") || "" : ""} aria-label={`Search ${locationLabel(location)}`}
                  placeholder="Mark, booking, container, order, driver…" />
                <button type="submit">Search</button>
            </form>
          </details>
        </div>
      </div>
      <nav aria-label="Warehouse navigation" className="warehouse-main-nav">{navigation.map(([key, label]) =>
        <Link key={key} href={key === "outbound" && returnTo ? returnTo : href(key)} aria-current={section === key ? "page" : undefined}>{label}</Link>)}</nav>
      {section === "checkins" && <nav aria-label="Check-in views" className="warehouse-subnav">{(site ? availableCheckinViews(location) : (["line", "cotton", "domestic", "containers"] as CheckinView[]).map(key => ({ key, label: { line: "Active Line", cotton: "Cotton", domestic: "Lumber & Other", containers: "Containers" }[key], href: `/inbound/checkin?${new URLSearchParams({ ...(location.terminal !== "all" ? { terminal: location.terminal } : {}), warehouse: "all", view: key })}` }))).map((item) =>
        <Link key={item.key} href={item.href} aria-current={(checkinViewForPath(path) ?? query.get("view")) === item.key ? "page" : undefined}>{item.label}</Link>)}</nav>}
      {section === "history" && <nav aria-label="History views" className="warehouse-subnav">
        <Link href={href("history")} aria-current={path !== "/inbound/history" ? "page" : undefined}>Check-in history</Link>
        <Link href="/inbound/history" aria-current={path === "/inbound/history" ? "page" : undefined}>Cotton processing report</Link>
      </nav>}
    </header>}
    <div className={visible ? "warehouse-page" : undefined}>
      {visible && staff && staff.role !== "admin" && (staff.role === "viewer" || staff.role === "accounting" || location.terminal !== staff.terminal) &&
        <p className="staff-readonly">Read-only warehouse view. {staff.role === "operator" ? `You can update records in ${staff.terminal === "HOU" ? "Houston" : staff.terminal === "DAL" ? "Dallas" : "Savannah"}.` : "Operational changes require a warehouse operator."}</p>}
      {visible && <div className="warehouse-breadcrumb" aria-label="Current warehouse context">{locationLabel(location)}
        {returnTo && <> / <Link href={returnTo}>← Back to booking list</Link></>}
        {path === "/inbound/history" && " / Processing report uses its own terminal and date filters"}
        {path === "/warehouse/gate" && " / QR setup lists all configured sites"}
      </div>}
      <Fragment key={path}>{visible && <WarehouseScrollMemory />}{children}</Fragment>
    </div>
  </Context.Provider>;
}
