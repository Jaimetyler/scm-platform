import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOrderDispatcher } from "@/lib/inbound/checkin/dispatcher";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase configuration");

    const sb = createClient(url, key);
    const { data: row, error } = await sb.from("inbound_checkin_rows")
      .select("matched_order_id,draft_status")
      .eq("id", id)
      .single();
    if (error || !row || row.draft_status !== "processed" || !row.matched_order_id) {
      return NextResponse.json({ dispatcherName: null, dispatcherId: null });
    }

    const baseUrl = process.env.MCLEOD_BASE_URL;
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!baseUrl || !token) throw new Error("Missing McLeod configuration");

    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const orderResponse = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/orders/${encodeURIComponent(row.matched_order_id)}`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!orderResponse.ok) throw new Error("McLeod order lookup failed");

    const dispatcher = getOrderDispatcher(await orderResponse.json());
    if (dispatcher.id && !dispatcher.name) {
      // Some McLeod order responses include only the dispatcher user ID.
      try {
        const userResponse = await fetch(
          `${baseUrl.replace(/\/+$/, "")}/users/${encodeURIComponent(dispatcher.id)}`,
          { headers, cache: "no-store", signal: AbortSignal.timeout(3000) }
        );
        if (userResponse.ok) {
          const user = await userResponse.json();
          if (String(user?.id ?? "").toLowerCase() === dispatcher.id.toLowerCase()) {
            dispatcher.name = String(user.name ?? "").trim() || null;
          }
        }
      } catch {
        // Keep the assigned user ID if the separate user lookup is unavailable.
      }
    }

    return NextResponse.json({ dispatcherName: dispatcher.name, dispatcherId: dispatcher.id });
  } catch {
    // McLeod can be temporarily unavailable. The edit warning still appears.
    return NextResponse.json({ dispatcherName: null, dispatcherId: null });
  }
}
