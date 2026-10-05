import { NextRequest, NextResponse } from "next/server";
import { AccessError, isWrite, requireActive, requireTerminal, warehouseReadPath, type Staff } from "./policy";
import { requireSameOrigin, staffDatabase, staffSession } from "./session";

const identities = new WeakMap<object, Staff>();
export const staffProfile = (req: NextRequest) => identities.get(req);
export function staffActor(req: NextRequest) {
  const staff = identities.get(req);
  if (!staff) throw new AccessError("Staff identity was not verified.", 401);
  return `${staff.email} [${staff.user_id}]`;
}
type Database = ReturnType<typeof staffDatabase>;
async function recordTerminal(db: Database, table: string, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new AccessError("Missing record identifier.", 400);
  const { data, error } = await db.from(table).select("terminal").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not verify record location");
  if (!data) throw new AccessError("Record not found.", 404);
  return data.terminal;
}
// Explicit allowlist: new operational endpoints default to administrator-only.
export async function authorizeStaffRequest(req: NextRequest, staff: Staff, db: Database) {
  requireActive(staff);
  const path = new URL(req.url).pathname.replace(/\/$/, "");
  if (isWrite(req.method)) requireSameOrigin(req);
  if (staff.role === "admin") return;
  if (["GET", "HEAD"].includes(req.method) && warehouseReadPath(path)) {
    if (staff.role === "operator") {
      const requested = new URL(req.url).searchParams.get("terminal");
      if (requested && requested.toLowerCase() !== "all") requireTerminal(staff, requested);
      const savedBooking = path.match(/^\/api\/warehouse\/outbound\/bookings\/([^/]+)(?:\/(?:export|container-info))?$/);
      const savedRow = path.match(/^\/api\/(?:warehouse\/checkin-bol|inbound\/checkin\/rows)\/([^/]+)(?:\/dispatcher)?$/);
      if (savedBooking) requireTerminal(staff, await recordTerminal(db, "cotton_outbound_bookings", savedBooking[1]));
      if (savedRow) requireTerminal(staff, await recordTerminal(db, "inbound_checkin_rows", savedRow[1]));
    }
    return;
  }
  if (path === "/api/auth/me" && req.method === "GET") return;
  if (staff.role !== "operator") throw new AccessError("This account has read-only warehouse access.");
  if (path === "/api/warehouse/outbound/preview" && req.method === "POST") {
    const form = await req.clone().formData();
    requireTerminal(staff, form.get("terminal")); return;
  }
  const inbound = path.match(/^\/api\/inbound\/checkin\/rows\/([^/]+)$/);
  const inventory = path.match(/^\/api\/warehouse\/inventory\/([^/]+)$/);
  const booking = path.match(/^\/api\/warehouse\/outbound\/bookings\/([^/]+)(?:\/(?:containers|rollover|lines(?:\/[^/]+(?:\/rollover)?)?))?$/);
  const creates = ["/api/inbound/checkin/rows", "/api/warehouse/domestic-queue", "/api/warehouse/outbound/bookings"];
  if (!inbound && !inventory && !booking && !creates.includes(path) && path !== "/api/warehouse/container-queue" && path !== "/api/inbound/sync")
    throw new AccessError("This operation requires an administrator.");
  let body: Record<string, any>;
  try {
    if (path === "/api/warehouse/outbound/bookings" && req.method === "POST") {
      const form = await req.clone().formData(); body = { terminal: form.get("terminal") };
    } else body = req.method === "DELETE" ? {} : await req.clone().json();
  } catch { throw new AccessError("Invalid request body.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Invalid request body.", 400);
  if (body.terminal !== undefined) requireTerminal(staff, body.terminal);
  if (inbound) requireTerminal(staff, await recordTerminal(db, "inbound_checkin_rows", inbound[1]));
  else if (inventory) requireTerminal(staff, await recordTerminal(db, "warehouse_inventory_lots", inventory[1]));
  else if (booking) requireTerminal(staff, await recordTerminal(db, "cotton_outbound_bookings", booking[1]));
  else if (path === "/api/warehouse/container-queue") requireTerminal(staff, await recordTerminal(db, "container_gate_queue", body.id));
  else if (path === "/api/warehouse/domestic-queue" && req.method !== "POST") requireTerminal(staff, await recordTerminal(db, "inbound_checkin_rows", body.id));
  else if (path === "/api/inbound/sync") {
    if (body.row?.source !== "live_checkin") throw new AccessError("Spreadsheet processing requires an administrator.");
    requireTerminal(staff, body.row?.terminal);
    requireTerminal(staff, await recordTerminal(db, "inbound_checkin_rows", body.checkinId));
  } else requireTerminal(staff, body.terminal);
}

export function withStaffAccess<T extends (req: NextRequest, ...args: any[]) => Promise<any>>(handler: T): T {
  return (async (req: NextRequest, ...args: any[]) => {
    let session: ReturnType<typeof staffSession>;
    try {
      session = staffSession(req);
      const { staff, user } = await session.identity();
      await authorizeStaffRequest(req, staff, staffDatabase());
      // List endpoints receive a server-enforced scope, including requests that omit terminal.
      if (staff.role === "operator" && ["GET", "HEAD"].includes(req.method) && warehouseReadPath(new URL(req.url).pathname)) {
        const scoped = new URL(req.url);
        scoped.searchParams.set("terminal", staff.terminal!);
        req = new NextRequest(scoped, { method: req.method, headers: req.headers });
      }
      identities.set(req, { ...staff, user_id: user.id });
      let activityId: string | undefined;
      if (isWrite(req.method)) {
        const { data, error } = await staffDatabase().from("scm_staff_activity").insert({
          actor_id: staff.id, actor_email: staff.email, action: req.method, target: new URL(req.url).pathname,
        }).select("id").single();
        if (error) throw new Error("Could not record staff request");
        activityId = data.id;
      }
      const response = await handler(req, ...args);
      if (activityId) await staffDatabase().from("scm_staff_activity").update({ response_status: response.status }).eq("id", activityId);
      return session.finish(response);
    } catch (reason) {
      const response = NextResponse.json({ ok: false, error: reason instanceof AccessError ? reason.message : "Could not verify or complete this staff request." },
        { status: reason instanceof AccessError ? reason.status : 503 });
      return session ? session.finish(response) : response;
    }
  }) as T;
}
