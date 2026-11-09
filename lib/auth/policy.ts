export type Staff = { id: string; email: string; name: string; role: "admin" | "operator" | "viewer" | "accounting";
  terminal: "HOU" | "SAV" | "DAL" | null; status: "pending" | "active" | "disabled"; user_id: string | null };
export class AccessError extends Error {
  status: number;
  constructor(message: string, status = 403) { super(message); this.status = status; }
}
export const isWrite = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);
export function requireActive(staff: Staff | null) {
  if (!staff || staff.status !== "active") throw new AccessError("Your staff account is not active.");
}
export function requireTerminal(staff: Staff, value: unknown) {
  if (staff.role === "admin") return;
  if (staff.role !== "operator" || !staff.terminal || String(value ?? "").toUpperCase() !== staff.terminal)
    throw new AccessError("You can update warehouse records only in your assigned terminal.");
}
export function warehouseReadPath(path: string) {
  return /^\/api\/warehouse\/(?:domestic-queue(?:\/match)?|domestic-history|container-queue|inventory|checkin-bol\/[^/]+|outbound\/(?:source-arrivals|bookings(?:\/[^/]+(?:\/(?:export|container-info))?)?))$/.test(path) ||
    /^\/api\/inbound\/(?:history|checkin\/(?:cotton-match|rows(?:\/[^/]+\/dispatcher)?))$/.test(path);
}
export function canUseInboundImporter(staff: Staff | null) {
  return staff?.status === "active" && (staff.role === "admin" || staff.role === "viewer");
}
export function staffHome(staff: Staff) {
  return staff.role === "operator" ? `/warehouse?terminal=${staff.terminal ?? "all"}&warehouse=all` : "/";
}
export function validInvite(value: Record<string, unknown>) {
  const email = String(value.email ?? "").trim().toLowerCase();
  const name = String(value.name ?? "").trim();
  const role = String(value.role ?? "");
  const terminal = role === "operator" ? String(value.terminal ?? "").toUpperCase() : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100 ||
      !["admin", "operator", "viewer", "accounting"].includes(role) || role === "operator" && !["HOU", "SAV", "DAL"].includes(terminal))
    throw new AccessError("Enter a name, email, role, and an operator terminal.", 400);
  return { email, name, role: role as Staff["role"], terminal: terminal as Staff["terminal"] };
}

export function canViewLateFees(staff: Staff | null) {
  return staff?.status === "active" && ["admin", "accounting", "viewer"].includes(staff.role);
}
export function lateFeeReadPage(path: string) {
  return ["/late-fees", "/late-fees/dallas", "/late-fees/savannah"].includes(path);
}
export function canUseBilling(staff: Staff | null) {
  return staff?.status === "active" && (staff.role === "admin" || staff.role === "accounting");
}
// Exact billing operations; maintenance/debug and future endpoints stay admin-only.
export function billingRequest(path: string, method: string) {
  if (method === "GET") return ["/api/late-fees/dallas", "/api/late-fees/savannah", "/api/ecotton-import", "/api/dray-import", "/api/dray-import/bols"].includes(path);
  return method === "POST" && [
    "/api/order-charges/preview", "/api/order-charges/apply",
    "/api/ecotton-import", "/api/dray-import", "/api/dray-import/dallas",
    "/api/dray-import/bols", "/api/dray-import/bols/imaging",
    "/api/late-fees/savannah/monthly-preview", "/api/late-fees/savannah/weekly-preview",
    "/api/late-fees/savannah/import-candidates", "/api/late-fees/savannah/sync",
    "/api/late-fees/savannah/sync-all", "/api/late-fees/dallas/sync",
  ].includes(path);
}
export function canAccessStaffPage(staff: Staff, path: string) {
  if (staff.role === "admin") return true;
  const warehouse = (path === "/warehouse" || path.startsWith("/warehouse/") || path === "/inbound" || path.startsWith("/inbound/")) &&
    path !== "/warehouse/gate";
  // Gate includes operational sheets as well as the admin-only QR setup index.
  const accountingWarehouse = warehouse && (!path.startsWith("/warehouse/gate/") ||
    /^\/warehouse\/gate\/(?:hou|sav|dal)\/[^/]+\/(?:line|domestic|containers|history)\/?$/i.test(path));
  if (staff.role === "accounting") return path === "/" || accountingWarehouse || path === "/order-charges" || path === "/late-fees" || path.startsWith("/late-fees/") ||
    ["/ecotton-import", "/dray-import", "/dray-import/dallas", "/cotton-locations", "/cotton-locations/outreach", "/cotton-locations/policies"].includes(path);
  return canViewLateFees(staff) && lateFeeReadPage(path) || warehouse || ["/cotton-locations", "/cotton-locations/outreach", "/cotton-locations/policies"].includes(path) ||
    path === "/" && staff.role === "viewer" ||
    ["/bunge-import", "/cotton-import"].includes(path) && canUseInboundImporter(staff);
}
