import { NextRequest, NextResponse } from "next/server";

function unauthorizedResponse() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SCM P&L"',
      "Cache-Control": "no-store",
    },
  });
}

function parseUsers(env: string | undefined) {
  if (!env) return [];

  return env.split(",").map((pair) => {
    const [user, pass] = pair.split(":");
    return { user, pass };
  });
}

export function middleware(req: NextRequest) {
  const isWarehouseGate = req.nextUrl.pathname.startsWith("/warehouse/gate") ||
    req.nextUrl.pathname.startsWith("/api/warehouse/gate-sites");
  const users = parseUsers(isWarehouseGate
    ? (process.env.WAREHOUSE_USERS || process.env.PNL_USERS)
    : process.env.PNL_USERS);

  if (!users.length) {
    return new NextResponse("No users configured.", { status: 500 });
  }

  const authHeader = req.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  try {
    const decoded = atob(authHeader.slice(6));
    const [providedUser, providedPass] = decoded.split(":");

    const match = users.find(
      (u) => u.user === providedUser && u.pass === providedPass
    );

    if (!match) {
      return unauthorizedResponse();
    }

    return NextResponse.next();
  } catch {
    return unauthorizedResponse();
  }
}

export const config = {
  matcher: [
    "/pnl/:path*",
    "/api/pnl/:path*",
    "/warehouse/gate/:path*",
    "/api/warehouse/gate-sites/:path*",
  ],
};
