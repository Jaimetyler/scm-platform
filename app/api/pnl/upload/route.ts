import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const negative = raw.includes("(") && raw.includes(")");
  const cleaned = raw.replace(/[$,()]/g, "");
  const num = Number(cleaned);

  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
}

function isValidRow(
  account: string | null,
  description: string | null,
  current: number | null,
  ytd: number | null
) {
  return !!(account && description && (current !== null || ytd !== null));
}

function normalizeReportMonth(input: string | null) {
  if (!input) return null;
  return `${input}-01`;
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "pnl upload api" });
}

export async function POST(req: Request) {
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

    const formData = await req.formData();
    const file = formData.get("file");
    const reportMonthRaw = formData.get("reportMonth");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const reportMonth = normalizeReportMonth(
      typeof reportMonthRaw === "string" ? reportMonthRaw : null
    );

    if (!reportMonth) {
      return NextResponse.json(
        { error: "Report month is required." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return NextResponse.json(
        { error: "Workbook has no sheets." },
        { status: 400 }
      );
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: null,
    });

    const { data: upload, error: uploadError } = await supabase
      .from("pnl_uploads")
      .insert({
        file_name: file.name,
        report_month: reportMonth,
        source_sheet: sheetName,
        status: "pending",
      })
      .select()
      .single();

    if (uploadError || !upload) {
      throw new Error(uploadError?.message || "Failed to create upload record.");
    }

    const rawRows: {
      upload_id: string;
      row_number: number;
      account_number: string | null;
      description: string | null;
      current_period: number | null;
      year_to_date: number | null;
      source_sheet: string;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];

      const account = row[0] ? String(row[0]).trim() : null;
      const description = row[1] ? String(row[1]).trim() : null;
      const current = toNumber(row[3]);
      const ytd = toNumber(row[5]);

      if (isValidRow(account, description, current, ytd)) {
        rawRows.push({
          upload_id: upload.id,
          row_number: i + 1,
          account_number: account,
          description,
          current_period: current,
          year_to_date: ytd,
          source_sheet: sheetName,
        });
      }
    }

    if (rawRows.length > 0) {
      const { error: rowsError } = await supabase
        .from("pnl_raw_rows")
        .insert(rawRows);

      if (rowsError) {
        throw new Error(rowsError.message);
      }
    }

    const { error: processError } = await supabase.rpc("process_pnl_upload", {
      p_upload_id: upload.id,
    });

    if (processError) {
      throw new Error(processError.message);
    }

    return NextResponse.json({
      ok: true,
      uploadId: upload.id,
      rowsInserted: rawRows.length,
    });
  } catch (error) {
    console.error("P&L upload API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown upload failure.",
      },
      { status: 500 }
    );
  }
}