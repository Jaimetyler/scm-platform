import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MCLEOD_BASE_URL = process.env.MCLEOD_BASE_URL!;
const MCLEOD_TOKEN = process.env.MCLEOD_AUTH_TOKEN!;

async function mcleodRequest(path: string, payload?: any, method = "PUT") {
  const res = await fetch(`${MCLEOD_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${MCLEOD_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`McLeod error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function createOrder(payload: any) {
  return mcleodRequest("/orders/create", payload, "PUT");
}

export async function POST(req: NextRequest) {
  try {
    const { import_run_id } = await req.json();

    const { data: rows, error } = await supabase
      .from("order_import_rows")
      .select("*")
      .eq("import_run_id", import_run_id)
      .eq("status", "ready");

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No ready rows to send",
      });
    }

    let success = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const payload = {
          ...row.mcleod_payload,
          company_id: "TMS",
        };

        const result = await createOrder(payload);
        const orderId = result?.id || null;

        await supabase
          .from("order_import_rows")
          .update({
            status: "created",
            mcleod_order_id: orderId,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        success++;
      } catch (err: any) {
        await supabase
          .from("order_import_rows")
          .update({
            status: "failed",
            error_message: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      import_run_id,
      success,
      failed,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}