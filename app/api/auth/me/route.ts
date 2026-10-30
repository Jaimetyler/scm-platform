import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
export const GET = withStaffAccess(async (req: NextRequest) => {
  const { id, email, name, role, terminal } = staffProfile(req)!;
  return NextResponse.json({ ok: true, staff: { id, email, name, role, terminal } });
});
