import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { AccessError, type Staff } from "./policy";

export function staffDatabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Staff database is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function appOrigin() {
  const origin = new URL(process.env.SCM_APP_URL || "http://localhost:3000").origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("Set SCM_APP_URL to the production HTTPS origin");
  return origin;
}
export function requireSameOrigin(req: NextRequest) {
  // JSON/API callers and internal processing must carry the configured origin too.
  if (req.headers.get("origin") !== appOrigin()) throw new AccessError("Request origin was not accepted.");
}
export function staffSession(req: NextRequest) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Staff sign-in is not configured");
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const auth = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: appOrigin().startsWith("https://"), path: "/" },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (items) => { for (const item of items) { req.cookies.set(item.name, item.value); pending.push(item); } },
    },
  });
  function finish(response: NextResponse) {
    for (const item of pending) response.cookies.set(item.name, item.value, item.options);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  async function identity() {
    const { data: { user }, error } = await auth.auth.getUser();
    if (error || !user?.email || !user.email_confirmed_at) throw new AccessError("Sign in to continue.", 401);
    const { data, error: profileError } = await staffDatabase().from("scm_staff").select("*")
      .eq("email", user.email.toLowerCase()).maybeSingle();
    if (profileError) throw new Error("Could not verify staff access");
    if (!data || data.status === "disabled" || data.user_id && data.user_id !== user.id)
      throw new AccessError("This account does not have SCM access.");
    if (data.status === "pending" && new Date(data.invite_expires_at).getTime() <= Date.now())
      throw new AccessError("Your invitation expired. Ask an administrator to resend it.");
    return { staff: data as Staff, user };
  }
  return { auth, finish, identity };
}
