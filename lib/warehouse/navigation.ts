import { CHECKIN_SITES, getCheckinSite, type TerminalCode } from "../inbound/checkin/sites.ts";

export type WarehouseLocation = { terminal: TerminalCode | "all"; siteCode: string };
export type WarehouseSection = "overview" | "checkins" | "inventory" | "outbound" | "history";
export type CheckinView = "cotton" | "line" | "domestic" | "containers";
export const ALL_LOCATIONS: WarehouseLocation = { terminal: "all", siteCode: "all" };
export const LOCATION_KEY = "scm.warehouse.location.v1";
export const CHECKIN_VIEW_KEY = "scm.warehouse.checkin-view.v1";

export function validLocation(value: unknown): WarehouseLocation {
  if (!value || typeof value !== "object") return ALL_LOCATIONS;
  const raw = value as Record<string, unknown>;
  const terminal = String(raw.terminal ?? "").toUpperCase();
  if (terminal !== "SAV" && terminal !== "HOU") return ALL_LOCATIONS;
  const siteCode = String(raw.siteCode ?? "all");
  return { terminal, siteCode: getCheckinSite(terminal, siteCode) ? siteCode : "all" };
}

export function routeLocation(path: string, query: URLSearchParams): WarehouseLocation | null {
  const match = path.match(/^\/(?:inbound\/checkin|warehouse\/(?:inventory|outbound|gate))\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (match) return validLocation({ terminal: match[1], siteCode: match[2] });
  if (query.has("terminal") || query.has("siteCode") || query.has("warehouse")) {
    return validLocation({ terminal: query.get("terminal"), siteCode: query.get("siteCode") });
  }
  return null;
}

export function locationQuery(location: WarehouseLocation) {
  const query = new URLSearchParams();
  if (location.terminal !== "all") query.set("terminal", location.terminal);
  if (location.siteCode !== "all") query.set("siteCode", location.siteCode);
  else query.set("warehouse", "all");
  return query;
}

export function sectionForPath(path: string): WarehouseSection {
  if (path.startsWith("/warehouse/outbound")) return "outbound";
  if (path.startsWith("/warehouse/inventory")) return "inventory";
  if (path === "/inbound/history" || path === "/warehouse/history" || /\/gate\/[^/]+\/[^/]+\/history$/.test(path)) return "history";
  if (path.startsWith("/inbound") || path.startsWith("/warehouse/gate/") || path.startsWith("/warehouse/checkin/")) return "checkins";
  return "overview";
}

export function checkinViewForPath(path: string): CheckinView | null {
  if (/^\/inbound\/checkin\/[^/]+\/[^/]+$/.test(path)) return "cotton";
  const view = path.match(/^\/warehouse\/gate\/[^/]+\/[^/]+\/(line|domestic|containers)$/)?.[1];
  return view as CheckinView || null;
}

export function availableCheckinViews(location: WarehouseLocation) {
  const site = getCheckinSite(location.terminal, location.siteCode);
  if (!site) return [];
  return [
    { key: "line" as const, label: "Domestic Line", href: `/warehouse/gate/${site.terminalSlug}/${site.siteCode}/line` },
    ...(site.materials.includes("cotton") ? [{ key: "cotton" as const, label: "Cotton", href: `/inbound/checkin/${site.terminalSlug}/${site.siteCode}` }] : []),
    ...(site.materials.includes("lumber") ? [{ key: "domestic" as const, label: "Lumber & Other", href: `/warehouse/gate/${site.terminalSlug}/${site.siteCode}/domestic` }] : []),
    ...(site.containers ? [{ key: "containers" as const, label: "Containers", href: `/warehouse/gate/${site.terminalSlug}/${site.siteCode}/containers` }] : []),
  ];
}

export function workspaceHref(section: WarehouseSection, location: WarehouseLocation, view: CheckinView = "cotton", filters = "") {
  const query = locationQuery(location);
  const site = getCheckinSite(location.terminal, location.siteCode);
  if (section === "checkins") {
    const views = availableCheckinViews(location);
    return (views.find((item) => item.key === view) ?? views.find((item) => item.key === "cotton" || item.key === "domestic") ?? views[0])?.href
      ?? `/inbound/checkin?${query}`;
  }
  if (section === "inventory" && site?.materials.includes("cotton")) return `/warehouse/inventory/${site.terminalSlug}/${site.siteCode}`;
  if (section === "history" && site) return `/warehouse/gate/${site.terminalSlug}/${site.siteCode}/history`;
  if (section === "outbound") {
    const saved = new URLSearchParams(filters);
    for (const key of ["basis", "view", "group", "q"]) if (saved.has(key)) query.set(key, saved.get(key)!);
  }
  const base = section === "overview" ? "/warehouse" : `/warehouse/${section}`;
  return `${base}?${query}`;
}

export function locationLabel(location: WarehouseLocation) {
  if (location.terminal === "all") return "All locations";
  return `${location.terminal === "SAV" ? "Savannah" : "Houston"} · ${location.siteCode === "all" ? "All sites" : location.siteCode}`;
}

export function sitesForLocation(location: WarehouseLocation) {
  return CHECKIN_SITES.filter((site) => (location.terminal === "all" || site.terminal === location.terminal)
    && (location.siteCode === "all" || site.siteCode === location.siteCode));
}

export function safeOutboundReturn(value: string | null): string | null {
  if (!value || !value.startsWith("/warehouse/outbound?")) return null;
  // Rebuild from known parameters only; never carry an arbitrary return URL.
  const query = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  return workspaceHref("outbound", routeLocation("/warehouse/outbound", query) ?? ALL_LOCATIONS, "cotton", query.toString());
}
