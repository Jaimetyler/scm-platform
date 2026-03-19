import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);

    const { data, error } = await supabase
      .from("v_pnl_monthly_summary")
      .select(
        "report_month, entity, current_income, current_expense, current_net, ytd_income, ytd_expense, ytd_net"
      )
      .order("report_month", { ascending: false })
      .order("entity", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown summary load failure.",
      },
      { status: 500 }
    );
  }
}