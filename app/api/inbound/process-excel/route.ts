import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";

export const runtime = "nodejs";

type Terminal = "SAV" | "HOU";
type EquipmentType = "V" | "F";

type ParsedRow = InboundExcelRow & {
  terminal: Terminal;
  equipmentType?: EquipmentType;
  __rowNum?: number;
  __sheetName?: string;
};

type SyncApiResponse = {
  ok?: boolean;
  skipped?: boolean;
  needsReview?: boolean;
  matchedOrderId?: string;
  reason?: string;
  error?: string;
  usedPossibleMatch?: boolean;
  row?: InboundExcelRow;
  mcleodResponse?: {
    ok?: boolean;
    status?: number;
    body?: string;
  };
  preview?: {
    status?: string;
    candidateCount?: number;
    reason?: string;
    matchedOrderId?: string | null;
  };
  [key: string]: unknown;
};

type ProcessResultStatus = "processed" | "skipped" | "failed" | "needs_review";

type ProcessResult = {
  id: string | null;
  rowNum: number | null;
  sheetName: string | null;
  terminal: Terminal;
  equipmentType: EquipmentType | null;
  mark: string;
  status: ProcessResultStatus;
  ok: boolean;
  matchedOrderId: string;
  message: string;
  disposition: string;
  row: {
    receivedDate: string;
    mark: string;
    shipper: string;
    bolBC: string;
    balesUnloaded: number | null;
    location: string;
    sourceSheet: string;
    terminal: Terminal;
    equipmentType: EquipmentType | null;
  };
  response: unknown;
};

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key);
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    const yyyy = String(parsed.y).padStart(4, "0");
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const raw = String(value).trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let [, m, d, y] = slashMatch;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const yyyy = String(dt.getFullYear()).padStart(4, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeCustomerKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function normalizeEquipmentType(value: unknown): EquipmentType | undefined {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (!normalized) return undefined;
  if (normalized === "V" || normalized === "VAN") return "V";
  if (normalized === "F" || normalized === "FLAT" || normalized === "FLATBED") return "F";

  return undefined;
}

function getFirstMatchingValue(
  row: Record<string, unknown>,
  candidates: string[]
): unknown {
  for (const originalHeader of Object.keys(row)) {
    const normalized = normalizeHeader(originalHeader);
    if (candidates.includes(normalized)) {
      return row[originalHeader];
    }
  }
  return undefined;
}

function mapSavannahWorkbookRowToInboundRow(
  row: Record<string, unknown>,
  rowNum: number,
  sheetName: string
): ParsedRow | null {
  const receivedDate = normalizeDate(
    getFirstMatchingValue(row, [
      "received date",
      "date",
      "delivery date",
      "receiveddate",
    ])
  );

  const mark = normalizeString(
    getFirstMatchingValue(row, [
      "mark",
      "refno",
      "reference",
      "reference no",
    ])
  ).toUpperCase();

  const shipper = normalizeString(
    getFirstMatchingValue(row, [
      "shipper",
      "customer",
      "consignor",
    ])
  ).toUpperCase();

  const bolBCRaw = getFirstMatchingValue(row, [
    "bol bc",
    "bol",
    "bol count",
    "bale count",
    "bales",
    "bolbc",
  ]);

  const balesUnloadedRaw = getFirstMatchingValue(row, [
    "bales unloaded",
    "unloaded",
    "balesunloaded",
    "unloaded bales",
  ]);

  const location = normalizeString(
    getFirstMatchingValue(row, [
      "location",
      "bin",
      "slot",
      "yard location",
    ])
  ).toUpperCase();

  const bolBC =
    bolBCRaw === null || bolBCRaw === undefined || String(bolBCRaw).trim() === ""
      ? ""
      : String(bolBCRaw).trim();

  const balesUnloaded = normalizeNullableNumber(balesUnloadedRaw);

  const hasEnoughData =
    receivedDate || mark || shipper || bolBC || balesUnloaded !== null || location;

  if (!hasEnoughData) return null;

  return {
    receivedDate,
    mark,
    shipper,
    bolBC,
    balesUnloaded,
    location,
    sourceSheet: sheetName,
    terminal: "SAV",
    equipmentType: undefined,
    __rowNum: rowNum,
    __sheetName: sheetName,
  };
}

function mapHoustonWorkbookRowToInboundRow(
  row: Record<string, unknown>,
  rowNum: number,
  sheetName: string
): ParsedRow | null {
  const receivedDate = normalizeDate(
    getFirstMatchingValue(row, ["date", "received date", "delivery date"])
  );

  const mark = normalizeString(
    getFirstMatchingValue(row, ["mark", "refno", "reference", "reference no"])
  ).toUpperCase();

  const shipper = normalizeString(
    getFirstMatchingValue(row, ["customer", "shipper", "consignor"])
  ).toUpperCase();

  const balesRaw = getFirstMatchingValue(row, [
    "bales",
    "total bales",
    "bale count",
    "bol count",
  ]);

  const location = normalizeString(
    getFirstMatchingValue(row, ["location", "bin", "slot", "yard location"])
  ).toUpperCase();

  const equipmentType = normalizeEquipmentType(
    getFirstMatchingValue(row, ["vanflat", "van flat", "vanflatbed"])
  );

  const balesUnloaded = normalizeNullableNumber(balesRaw);
  const bolBC =
    balesRaw === null || balesRaw === undefined || String(balesRaw).trim() === ""
      ? ""
      : String(balesRaw).trim();

  const hasEnoughData =
    receivedDate || mark || shipper || bolBC || balesUnloaded !== null || location;

  if (!hasEnoughData) return null;

  return {
    receivedDate,
    mark,
    shipper,
    bolBC,
    balesUnloaded,
    location,
    sourceSheet: sheetName,
    terminal: "HOU",
    equipmentType,
    __rowNum: rowNum,
    __sheetName: sheetName,
  };
}

function mapWorkbookRowToInboundRow(
  row: Record<string, unknown>,
  rowNum: number,
  sheetName: string,
  terminal: Terminal
): ParsedRow | null {
  if (terminal === "HOU") {
    return mapHoustonWorkbookRowToInboundRow(row, rowNum, sheetName);
  }

  return mapSavannahWorkbookRowToInboundRow(row, rowNum, sheetName);
}

function getMatchedOrderId(data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>).matchedOrderId;
    return value ? String(value) : "";
  }
  return "";
}

function isOutsideCarrierNoMatch(obj: SyncApiResponse): boolean {
  if (obj.ok === false && obj.error === "No match") return true;

  const preview = obj.preview;
  if (
    preview &&
    preview.status === "No Match" &&
    (preview.candidateCount === 0 || preview.candidateCount === undefined)
  ) {
    return true;
  }

  return false;
}

function classifySyncResponse(syncResOk: boolean, data: unknown): {
  status: ProcessResultStatus;
  ok: boolean;
  message: string;
  matchedOrderId: string;
  disposition: string;
} {
  const matchedOrderId = getMatchedOrderId(data);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      status: syncResOk ? "processed" : "failed",
      ok: syncResOk,
      message: syncResOk ? "Processed" : "Failed",
      matchedOrderId,
      disposition: syncResOk ? "confirmed_match" : "unresolved",
    };
  }

  const obj = data as SyncApiResponse;

  if (obj.skipped) {
    return {
      status: "skipped",
      ok: true,
      message: obj.reason || "Already delivered",
      matchedOrderId,
      disposition: "confirmed_match",
    };
  }

  if (obj.needsReview) {
    return {
      status: "needs_review",
      ok: false,
      message: obj.error || obj.reason || "Needs review",
      matchedOrderId,
      disposition: "unresolved",
    };
  }

  if (obj.ok === true) {
    const mcleodOk =
      obj.mcleodResponse && typeof obj.mcleodResponse === "object"
        ? obj.mcleodResponse.ok !== false
        : true;

    return {
      status: mcleodOk ? "processed" : "failed",
      ok: mcleodOk,
      message: mcleodOk
        ? obj.usedPossibleMatch
          ? "Processed from possible match"
          : "Processed"
        : obj.error || "McLeod update failed",
      matchedOrderId,
      disposition: mcleodOk ? "confirmed_match" : "unresolved",
    };
  }

  if (isOutsideCarrierNoMatch(obj)) {
    return {
      status: "failed",
      ok: false,
      message: obj.error || obj.reason || "No match",
      matchedOrderId,
      disposition: "outside_carrier",
    };
  }

  return {
    status: "failed",
    ok: false,
    message: obj.error || obj.reason || "Failed",
    matchedOrderId,
    disposition: "unresolved",
  };
}

function buildUniqueKey(row: ParsedRow) {
  const baleCount =
    row.balesUnloaded ??
    (row.bolBC && !Number.isNaN(Number(row.bolBC)) ? Number(row.bolBC) : null);

  return [
    row.terminal || "",
    row.receivedDate || "",
    row.mark || "",
    normalizeCustomerKey(row.shipper || ""),
    baleCount ?? "",
  ].join("|");
}

async function saveInboundResult(
  row: ParsedRow,
  classified: {
    status: ProcessResultStatus;
    ok: boolean;
    message: string;
    matchedOrderId: string;
    disposition: string;
  },
  response: unknown
): Promise<string | null> {
  try {
    const sb = getSupabase();

    const baleCount =
      row.balesUnloaded ??
      (row.bolBC && !Number.isNaN(Number(row.bolBC)) ? Number(row.bolBC) : null);

    const uniqueKey = buildUniqueKey(row);

    const payload = {
      unique_key: uniqueKey,
      received_date: row.receivedDate || null,
      mark: row.mark || null,
      shipper: row.shipper || null,
      bale_count: baleCount,
      location: row.location || null,
      source_sheet: row.sourceSheet || row.__sheetName || null,
      terminal: row.terminal,
      equipment_type: row.equipmentType ?? null,
      matched_order_id: classified.matchedOrderId || null,
      status: classified.status,
      reason: classified.message || null,
      disposition: classified.disposition,
      last_seen_at: new Date().toISOString(),
    };

    const { data: existing, error: findError } = await sb
      .from("inbound_results")
      .select("id, seen_count, disposition, first_seen_at")
      .eq("unique_key", uniqueKey)
      .maybeSingle();

    if (findError) {
      console.error("FIND_INBOUND_RESULT_ERROR", findError.message, payload, response);
      return null;
    }

    if (existing?.id) {
      const { data: updated, error: updateError } = await sb
        .from("inbound_results")
        .update({
          ...payload,
          seen_count: (existing.seen_count ?? 1) + 1,
          disposition:
            existing.disposition === "outside_carrier" &&
            classified.disposition !== "confirmed_match"
              ? "outside_carrier"
              : classified.disposition,
        })
        .eq("id", existing.id)
        .select("id")
        .single();

      if (updateError) {
        console.error("UPDATE_INBOUND_RESULT_ERROR", updateError.message, payload, response);
        return null;
      }

      return updated?.id ?? existing.id;
    }

    const { data: inserted, error: insertError } = await sb
      .from("inbound_results")
      .insert({
        ...payload,
        first_seen_at: new Date().toISOString(),
        seen_count: 1,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("INSERT_INBOUND_RESULT_ERROR", insertError.message, payload, response);
      return null;
    }

    return inserted?.id ?? null;
  } catch (error) {
    console.error("SAVE_INBOUND_RESULT_EXCEPTION", error);
    return null;
  }
}

async function processOneRow(
  req: NextRequest,
  row: ParsedRow
): Promise<ProcessResult> {
  const origin = req.nextUrl.origin;

  const syncRes = await fetch(`${origin}/api/inbound/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") ?? "",
      authorization: req.headers.get("authorization") ?? "",
    },
    body: JSON.stringify({
      row: {
        receivedDate: row.receivedDate,
        mark: row.mark,
        shipper: row.shipper,
        bolBC: row.bolBC,
        balesUnloaded: row.balesUnloaded,
        location: row.location,
        sourceSheet: row.sourceSheet,
        terminal: row.terminal,
        equipmentType: row.equipmentType ?? null,
      },
    }),
    cache: "no-store",
  });

  const text = await syncRes.text();
  let parsed: unknown = text;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  const classified = classifySyncResponse(syncRes.ok, parsed);
  const savedId = await saveInboundResult(row, classified, parsed);

  return {
    id: savedId,
    rowNum: row.__rowNum ?? null,
    sheetName: row.__sheetName ?? null,
    terminal: row.terminal,
    equipmentType: row.equipmentType ?? null,
    mark: row.mark,
    status: classified.status,
    ok: classified.ok,
    matchedOrderId: classified.matchedOrderId,
    message: classified.message,
    disposition: classified.disposition,
    row: {
      receivedDate: row.receivedDate,
      mark: row.mark,
      shipper: row.shipper,
      bolBC: row.bolBC,
      balesUnloaded: row.balesUnloaded,
      location: row.location,
      sourceSheet: row.sourceSheet,
      terminal: row.terminal,
      equipmentType: row.equipmentType ?? null,
    },
    response: parsed,
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const terminalRaw = String(formData.get("terminal") ?? "SAV").toUpperCase();
    const terminal: Terminal = terminalRaw === "HOU" ? "HOU" : "SAV";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing uploaded file" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), {
      type: "buffer",
      cellDates: false,
    });

    const parsedRows: ParsedRow[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: true,
      });

      rows.forEach((row, index) => {
        const mapped = mapWorkbookRowToInboundRow(row, index + 2, sheetName, terminal);
        if (mapped) parsedRows.push(mapped);
      });
    }

    if (parsedRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No usable rows found in workbook",
          fileName: file.name,
          sheetNames: workbook.SheetNames,
          terminal,
        },
        { status: 400 }
      );
    }

    const results: ProcessResult[] = [];

    for (const row of parsedRows) {
      const result = await processOneRow(req, row);
      results.push(result);
    }

    const processedCount = results.filter((r) => r.status === "processed").length;
    const skippedCount = results.filter((r) => r.status === "skipped").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const needsReviewCount = results.filter((r) => r.status === "needs_review").length;
    const outsideCarrierCount = results.filter(
      (r) => r.disposition === "outside_carrier"
    ).length;

    return NextResponse.json({
      ok: failedCount === 0 && needsReviewCount === 0,
      mode: "live",
      routeVersion: "2026-03-25-process-excel-v6",
      terminal,
      fileName: file.name,
      totalRows: parsedRows.length,
      processedCount,
      skippedCount,
      failedCount,
      needsReviewCount,
      outsideCarrierCount,
      results,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}