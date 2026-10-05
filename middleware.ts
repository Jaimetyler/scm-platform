import { NextRequest, NextResponse } from "next/server";
import { staffSession } from "@/lib/auth/session";
import { AccessError, staffHome } from "@/lib/auth/policy";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // APIs authenticate in their own handlers, including direct/internal calls.
  if (path.startsWith("/api/") || /^\/gate\/check-in\/[^/]+$/.test(path) ||
      ["/login", "/auth/accept", "/auth/password", "/access-denied"].includes(path)) return NextResponse.next();
  let session: ReturnType<typeof staffSession>;
  try {
    session = staffSession(req);
    const { staff } = await session.identity();
    if (staff.status === "pending") return session.finish(NextResponse.redirect(new URL("/auth/password", req.url)));
    const warehouse = path === "/warehouse" || path.startsWith("/warehouse/") || path === "/inbound" || path.startsWith("/inbound/");
    if (staff.role !== "admin" && (path === "/" || !warehouse || path === "/warehouse/gate"))
      return session.finish(NextResponse.redirect(new URL(staffHome(staff), req.url)));
    if (staff.role === "operator") {
      const routeTerminal = path.match(/^\/(?:warehouse\/(?:outbound|inventory|gate)|inbound\/checkin)\/(hou|sav)\//i)?.[1]?.toUpperCase();
      const queryTerminal = req.nextUrl.searchParams.get("terminal")?.toUpperCase();
      if (routeTerminal && routeTerminal !== staff.terminal || queryTerminal && queryTerminal !== "ALL" && queryTerminal !== staff.terminal)
        return session.finish(NextResponse.redirect(new URL(staffHome(staff), req.url)));
    }
    return session.finish(NextResponse.next({ request: { headers: req.headers } }));
  } catch (reason) {
    const destination = reason instanceof AccessError && reason.status === 401 ? "/login" : "/access-denied";
    const response = NextResponse.redirect(new URL(destination, req.url));
    return session ? session.finish(response) : response;
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|scm-logo.png).*)"] };
