export type Staff = { id: string; email: string; name: string; role: "admin" | "operator" | "viewer";
  terminal: "HOU" | "SAV" | null; status: "pending" | "active" | "disabled"; user_id: string | null };
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
export function staffHome(staff: Staff) {
  return staff.role === "admin" ? "/" : `/warehouse?terminal=${staff.terminal ?? "all"}&warehouse=all`;
}
export function validInvite(value: Record<string, unknown>) {
  const email = String(value.email ?? "").trim().toLowerCase();
  const name = String(value.name ?? "").trim();
  const role = String(value.role ?? "");
  const terminal = role === "operator" ? String(value.terminal ?? "").toUpperCase() : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100 ||
      !["admin", "operator", "viewer"].includes(role) || role === "operator" && !["HOU", "SAV"].includes(terminal))
    throw new AccessError("Enter a name, email, role, and an operator terminal.", 400);
  return { email, name, role: role as Staff["role"], terminal: terminal as Staff["terminal"] };
}
