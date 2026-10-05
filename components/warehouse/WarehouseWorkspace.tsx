"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { CHECKIN_SITES, getCheckinSite } from "@/lib/inbound/checkin/sites";
import { ALL_LOCATIONS, LOCATION_KEY, CHECKIN_VIEW_KEY, validLocation, routeLocation, sectionForPath, checkinViewForPath,
  availableCheckinViews, workspaceHref, locationLabel, safeOutboundReturn, type WarehouseLocation, type WarehouseSection, type CheckinView } from "@/lib/warehouse/navigation";
import { WarehouseScrollMemory } from "./useWarehouseViewState";
import "./warehouse-workspace.css";

const Context = createContext<{ location: WarehouseLocation; ready: boolean; href: (section: WarehouseSection) => string }>({
  location: ALL_LOCATIONS, ready: false, href: (section) => workspaceHref(section, ALL_LOCATIONS),
});
export const useWarehouseWorkspace = () => useContext(Context);

export default function WarehouseWorkspace({ children }: { children: ReactNode }) {
  const path = usePathname();
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
  const location = explicit ?? remembered;
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
  const navigation: [WarehouseSection, string][] = [["overview", "Operations"], ["outbound", "Outbound"], ["inventory", "Inventory"], ["history", "History"]];
  const locationHref = (next: WarehouseLocation) => workspaceHref(section, next, view, filters);
  return <Context.Provider value={{ location, ready, href }}>
    {visible && <header className="warehouse-workspace" aria-label="Warehouse workspace">
      <div className="warehouse-brand-row"><Link href={href("overview")} className="warehouse-brand">SCM <span>Warehouse operations</span></Link>
        <div className="warehouse-utilities"><Link href="/warehouse/gate">Driver QR setup</Link><Link href="/">Platform home</Link></div>
      </div>
      <div className="warehouse-location-row">
        <nav aria-label="Terminal" className="warehouse-location-options">
          {[{ terminal: "all" as const, label: "All locations" }, { terminal: "SAV" as const, label: "Savannah" }, { terminal: "HOU" as const, label: "Houston" }].map((item) =>
            <Link key={item.terminal} href={locationHref({ terminal: item.terminal, siteCode: "all" })} aria-current={location.terminal === item.terminal ? "true" : undefined}>{item.label}</Link>)}
        </nav>
        {location.terminal !== "all" && <nav aria-label="Warehouse location" className="warehouse-location-options warehouse-sites">
          <Link href={locationHref({ terminal: location.terminal, siteCode: "all" })} aria-current={location.siteCode === "all" ? "true" : undefined}>All sites</Link>
          {CHECKIN_SITES.filter((item) => item.terminal === location.terminal).sort((a, b) => a.siteCode.localeCompare(b.siteCode, undefined, { numeric: true })).map((item) =>
            <Link key={item.siteCode} href={locationHref({ terminal: item.terminal, siteCode: item.siteCode })} aria-current={location.siteCode === item.siteCode ? "true" : undefined}>{item.siteCode}</Link>)}
        </nav>}
      </div>
      <nav aria-label="Warehouse navigation" className="warehouse-main-nav">{navigation.map(([key, label]) =>
        <Link key={key} href={key === "outbound" && returnTo ? returnTo : href(key)} aria-current={section === key ? "page" : undefined}>{label}</Link>)}</nav>
      {section === "checkins" && site && path !== "/inbound" && <nav aria-label="Check-in views" className="warehouse-subnav"><Link href={href("overview")} className="warehouse-back-operations">← Operations</Link>{availableCheckinViews(location).map((item) =>
        <Link key={item.key} href={item.href} aria-current={checkinViewForPath(path) === item.key ? "page" : undefined}>{item.label}</Link>)}</nav>}
      {section === "history" && <nav aria-label="History views" className="warehouse-subnav">
        <Link href={href("history")} aria-current={path !== "/inbound/history" ? "page" : undefined}>Check-in history</Link>
        <Link href="/inbound/history" aria-current={path === "/inbound/history" ? "page" : undefined}>Cotton processing report</Link>
      </nav>}
    </header>}
    <div className={visible ? "warehouse-page" : undefined}>
      {visible && <div className="warehouse-breadcrumb" aria-label="Current warehouse context">{locationLabel(location)}
        {returnTo && <> / <Link href={returnTo}>← Back to booking list</Link></>}
        {path === "/inbound/history" && " / Processing report uses its own terminal and date filters"}
        {path === "/warehouse/gate" && " / QR setup lists all configured sites"}
      </div>}
      <Fragment key={path}>{visible && <WarehouseScrollMemory />}{children}</Fragment>
    </div>
  </Context.Provider>;
}
