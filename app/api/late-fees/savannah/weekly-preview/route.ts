import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type WeeklyRow = {
  rowNumber: number;
  customer: string;
  locationCode: string;
  baleCount: number | null;
  actualPickup: string | null;
  actualDelivery: string | null;
  originalDate: string | null;
  lateDays: number | null;
  status: "ok" | "missing_data" | "not_late";
  reason?: string;
};

function cellToDateString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;

    const yyyy = String(parsed.y);
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const raw = String(value).trim();
  const dt = new Date(raw);

  if (Number.isNaN(dt.getTime())) return null;

  return dt.toISOString().slice(0, 10);
}

function dateDiffDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;

  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);

  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;

  return Math.floor((e.getTime() - s.getTime()) / 86_400_000);
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing file" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return NextResponse.json(
        { ok: false, error: "No sheets found" },
        { status: 400 }
      );
    }

    const sheet = workbook.Sheets[firstSheetName];

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: "A",
      defval: "",
      raw: true,
    });

    const parsedRows: WeeklyRow[] = rows
      .map((r, index) => {
        const customer = String(r.A ?? "").trim();
        const locationCode = String(r.B ?? "").trim();
        const baleCount = parseNum(r.D);

        const actualPickup = cellToDateString(r.J);
        const actualDelivery = cellToDateString(r.K);
        const originalDate = cellToDateString(r.M);

        const lateDays = dateDiffDays(originalDate, actualDelivery);

        let status: WeeklyRow["status"] = "ok";
        let reason: string | undefined;

        if (!customer || !locationCode || baleCount === null || !actualDelivery || !originalDate) {
          status = "missing_data";
          reason = "Missing customer, location, bale count, actual delivery, or original date";
        } else if (lateDays !== null && lateDays <= 0) {
          status = "not_late";
          reason = "Delivered on or before original date";
        }

        return {
          rowNumber: index + 1,
          customer,
          locationCode,
          baleCount,
          actualPickup,
          actualDelivery,
          originalDate,
          lateDays,
          status,
          reason,
        };
      })
      .filter((r) => r.customer || r.locationCode || r.baleCount !== null);

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      sheetName: firstSheetName,
      totalRows: parsedRows.length,
      rows: parsedRows,
      summary: {
        ok: parsedRows.filter((r) => r.status === "ok").length,
        missingData: parsedRows.filter((r) => r.status === "missing_data").length,
        notLate: parsedRows.filter((r) => r.status === "not_late").length,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}