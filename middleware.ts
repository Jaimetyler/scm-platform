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
    if (!(reason instanceof AccessError) || reason.status >= 500) {
      const response = new NextResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>SCM temporarily unavailable</title><main><h1>Staff access is temporarily unavailable</h1><p>Your access could not be checked. Wait a moment, then reload this page.</p><button onclick="location.reload()">Try again</button></main></html>', { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "10", "Cache-Control": "private, no-store" } });
      return session ? session.finish(response) : response;
    }
    const destination = reason instanceof AccessError && reason.status === 401 ? "/login" : "/access-denied";
    const response = NextResponse.redirect(new URL(destination, req.url));
    return session ? session.finish(response) : response;
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|scm-logo.png).*)"] };
