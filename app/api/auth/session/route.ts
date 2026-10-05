import { NextRequest, NextResponse } from "next/server";
import { AccessError, staffHome } from "@/lib/auth/policy";
import { appOrigin, requireSameOrigin, staffDatabase, staffSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  let session: ReturnType<typeof staffSession>;
  try {
    requireSameOrigin(req);
    const body = await req.json();
    session = staffSession(req);
    const client = session.auth.auth;
    if (body.action === "logout") {
      await client.signOut({ scope: "local" });
      return session.finish(NextResponse.json({ ok: true, next: "/login" }));
    }
    if (body.action === "recover") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError("Enter your email address.", 400);
      await client.resetPasswordForEmail(email, { redirectTo: `${appOrigin()}/auth/accept` });
      return session.finish(NextResponse.json({ ok: true, message: "If this email has an account, a reset link will arrive shortly." }));
    }
    if (body.action === "login") {
      const { error } = await client.signInWithPassword({ email: String(body.email ?? "").trim().toLowerCase(), password: String(body.password ?? "") });
      if (error) throw new AccessError("Email or password was not accepted.", 401);
    } else if (body.action === "accept") {
      if (!["invite", "recovery"].includes(body.type) || typeof body.token_hash !== "string" || body.token_hash.length > 512)
        throw new AccessError("Invalid invitation link.", 400);
      const { error } = await client.verifyOtp({ token_hash: body.token_hash, type: body.type });
      if (error) throw new AccessError("This link expired or was already used. Request another email.", 400);
    } else if (body.action !== "password") throw new AccessError("Unknown sign-in action.", 400);
    const { staff, user } = await session.identity();
    if (body.action === "password") {
      if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128)
        throw new AccessError("Use a password between 12 and 128 characters.", 400);
      const { error } = await client.updateUser({ password: body.password });
      if (error) throw new AccessError(error.message, 400);
      if (staff.status === "pending") {
        const result = await staffDatabase().rpc("scm_accept_staff", { p_id: staff.id, p_user_id: user.id, p_email: user.email });
        if (result.error) throw new AccessError("Could not activate this invitation. Ask an administrator to check its status.");
      }
      return session.finish(NextResponse.json({ ok: true, next: staffHome(staff) }));
    }
    return session.finish(NextResponse.json({ ok: true,
      next: body.action === "accept" || staff.status === "pending" ? "/auth/password" : staffHome(staff) }));
  } catch (reason) {
    const response = NextResponse.json({ ok: false, error: reason instanceof AccessError ? reason.message : "Sign-in is unavailable. Please try again." },
      { status: reason instanceof AccessError ? reason.status : 503 });
    return session ? session.finish(response) : response;
  }
}
