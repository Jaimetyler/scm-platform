import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { validInvite, AccessError } from "@/lib/auth/policy";
import { sendStaffInvitation } from "@/lib/auth/invitations";

export const GET = withStaffAccess(async () => {
  const { data, error } = await staffDatabase().from("scm_staff").select("id,email,name,role,terminal,status,invited_at,accepted_at,invite_expires_at").order("name");
  if (error) throw error;
  return NextResponse.json({ ok: true, users: data });
});
export const POST = withStaffAccess(async (req: NextRequest) => {
  const body = await req.json();
  if (!["invite", "resend", "disable", "access"].includes(body.action)) throw new AccessError("Unknown user action.", 400);
  const values = body.action === "invite" || body.action === "access" ? validInvite(body) : null;
  const db = staffDatabase();
  const { data, error } = await db.rpc("scm_manage_staff", { p_actor: staffProfile(req)!.id, p_action: body.action,
    p_target: body.id || null, p_email: values?.email, p_name: values?.name, p_role: values?.role, p_terminal: values?.terminal });
  if (error) throw new AccessError(error.code === "23505" ? "That email is already listed. Use Resend or Reinvite on its existing row." : error.message, 409);
  const staff = Array.isArray(data) ? data[0] : data;
  if (["invite", "resend"].includes(body.action)) {
    const { error: mailError } = await sendStaffInvitation(staff.email, db);
    if (mailError) return NextResponse.json({ ok: false, saved: true,
      error: "The pending account was saved, but the email was not sent. Check Supabase Auth email settings, then use Resend. " + mailError.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
});
