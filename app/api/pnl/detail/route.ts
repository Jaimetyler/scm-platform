import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const reportMonth = searchParams.get("reportMonth");
    const entity = searchParams.get("entity");

    if (!reportMonth || !entity) {
      return NextResponse.json(
        { error: "Missing reportMonth or entity." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("v_pnl_detail_lines")
      .select(
        "report_month, entity, section, account_number, description, current_period, year_to_date, rule_applied"
      )
      .eq("report_month", reportMonth)
      .eq("entity", entity)
      .order("section", { ascending: true })
      .order("account_number", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown detail load failure.",
      },
      { status: 500 }
    );
  }
}