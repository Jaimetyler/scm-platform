import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { staffSession, appOrigin } from "./session";
import { requireActive } from "./policy";

// Server components that read private records check independently of middleware.
export async function requireStaffPage() {
  try {
    const req = new NextRequest(appOrigin(), { headers: new Headers(await headers()) });
    const { staff } = await staffSession(req).identity();
    requireActive(staff);
    return staff;
  } catch { redirect("/login"); }
}
