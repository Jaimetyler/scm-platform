import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

const ALLOWED_REVENUE_CODES_BY_TERMINAL: Record<string, string[]> = {
  SAV: ["LOCAL"],
  DAL: ["DLOCA"],
  HOU: ["HLOCA"],
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MCLEOD_BASE_URL = process.env.MCLEOD_BASE_URL!;
const MCLEOD_TOKEN = process.env.MCLEOD_AUTH_TOKEN!;

async function mcleodRequest(path: string) {
  const res = await fetch(`${MCLEOD_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${MCLEOD_TOKEN}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`McLeod error ${res.status}: ${text}`);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function normalize(value: any) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function cleanAmount(value: any) {
  const n = Number(String(value || "0").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function cleanNumber(value: any) {
  const n = Number(String(value || "0").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function findIndex(headers: string[], names: string[]) {
  return headers.findIndex((h) => names.includes(normalize(h)));
}

function findHeaderRow(matrix: string[][]) {
  return matrix.findIndex((row) =>
    row.some((cell) => normalize(cell) === "SHIPPING ORDER #")
  );
}

function numericTariffId(value: any) {
  const s = String(value || "").trim();
  if (!/^\d+$/.test(s)) return undefined;
  return Number(s);
}

function extractRows(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.rows)) return res.rows;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.results)) return res.results;
  if (Array.isArray(res?.row)) return res.row;
  if (Array.isArray(res?.RowOrders)) return res.RowOrders;

  // McLeod sometimes wraps deeper
  for (const value of Object.values(res || {})) {
    if (Array.isArray(value)) return value as any[];
    if (value && typeof value === "object") {
      const nested = extractRows(value);
      if (nested.length) return nested;
    }
  }

  return [];
}

async function findOrderCandidates(blnum: string, terminal: string) {
  try {
    const terminalKey = normalize(terminal);
    const allowed = ALLOWED_REVENUE_CODES_BY_TERMINAL[terminalKey] || [];
    const allCandidates: any[] = [];

    const paths = [
      `/orders/search?blnum=${encodeURIComponent(blnum)}`,
      `/orders?blnum=${encodeURIComponent(blnum)}`,
    ];

    for (const path of paths) {
      const search = await mcleodRequest(path);
      const rows = extractRows(search).filter((r: any) => r?.id);

      for (const r of rows) {
        const revenueCode =
          r.revenue_code_id ||
          r.revenueCodeId ||
          r.revenue_code ||
          r.revenueCode ||
          "unknown";

        const code = normalize(revenueCode);

        allCandidates.push({
          id: r.id,
          revenue_code_id: revenueCode,
          status: r.status || r.movement_status || undefined,
          source_path: path,
          allowed_match: allowed.includes(code),
        });
      }
    }

    return allCandidates
      .filter((r) => {
        const code = normalize(r.revenue_code_id);
        return r.id && code !== "UNKNOWN" && allowed.includes(code);
      })
      .map((r) => ({
        id: r.id,
        revenue_code_id: r.revenue_code_id,
        status: r.status,
        source_path: r.source_path,
      }));
  } catch (err: any) {
    return [{ id: null, revenue_code_id: "lookup_failed", error: err.message }];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { csvText, terminal } = await req.json();

    const parsed = Papa.parse<string[]>(csvText || "", {
      header: false,
      skipEmptyLines: true,
    });

    const matrix = parsed.data as string[][];
    const headerRowIdx = findHeaderRow(matrix);

    if (headerRowIdx === -1) {
      return NextResponse.json(
        { ok: false, error: "Could not find Shipping Order # header" },
        { status: 400 }
      );
    }

    const header = matrix[headerRowIdx] || [];
    const dataRows = matrix.slice(headerRowIdx + 1);
    const normalizedHeaders = header.map((h) => normalize(h));

    const orderNoIdx = findIndex(normalizedHeaders, ["SHIPPING ORDER #"]);
    const tariffIdIdx = findIndex(normalizedHeaders, ["TARIFF ID"]);
    const descIdx = findIndex(normalizedHeaders, ["DESCRIPTION"]);
    const qtyIdx = findIndex(normalizedHeaders, ["QUANTITY"]);
    const totalChargesIdx = findIndex(normalizedHeaders, ["TOTAL CHARGES"]);

    if (orderNoIdx === -1 || descIdx === -1) {
      return NextResponse.json(
        {
          ok: false,
          error: "Could not find required columns",
          headers: normalizedHeaders,
        },
        { status: 400 }
      );
    }

    const { data: descMap, error: descError } = await supabase
      .from("billing_charge_description_xref")
      .select("*")
      .eq("terminal", terminal)
      .eq("active", true);

    if (descError) throw descError;

    const { data: tariffMap, error: tariffError } = await supabase
      .from("tariff_charge_xref")
      .select("*")
      .eq("terminal", terminal)
      .eq("active", true);

    if (tariffError) throw tariffError;

    const descLookup = new Map(
      (descMap || []).map((r) => [
        normalize(r.normalized_description),
        Number(r.tariff_id),
      ])
    );

    const tariffLookup = new Map(
      (tariffMap || []).map((r) => [
        Number(r.tariff_id),
        {
          charge_id: String(r.mcleod_code),
          description: String(r.description || r.mcleod_code),
        },
      ])
    );

    const grouped: Record<string, any[]> = {};
    const skipped: any[] = [];

    for (const row of dataRows) {
      const orderNo = String(row[orderNoIdx] || "").trim();
      const rawDesc = String(row[descIdx] || "").trim();
      const desc = normalize(rawDesc);

      if (!orderNo || !desc) continue;

      let qty = qtyIdx !== -1 ? cleanNumber(row[qtyIdx]) : 0;

      if (!qty && terminal === "SAV" && qtyIdx > 0) {
        qty = cleanNumber(row[qtyIdx - 1]);
      }

      let amount = 0;

      if (totalChargesIdx !== -1) {
        amount = cleanAmount(row[totalChargesIdx]);

        if (!amount && terminal === "SAV" && totalChargesIdx > 0) {
          amount = cleanAmount(row[totalChargesIdx - 1]);
        }
      }

      const tariffId =
        (tariffIdIdx !== -1 ? numericTariffId(row[tariffIdIdx]) : undefined) ??
        numericTariffId(rawDesc) ??
        descLookup.get(desc);

      if (!tariffId) {
        skipped.push({
          blnum: orderNo,
          description: rawDesc,
          amount,
          reason: "No description mapping",
        });
        continue;
      }

      const tariff = tariffLookup.get(tariffId);

      if (!tariff) {
        skipped.push({
          blnum: orderNo,
          description: rawDesc,
          amount,
          tariff_id: tariffId,
          reason: "No tariff mapping",
        });
        continue;
      }

      if (!grouped[orderNo]) grouped[orderNo] = [];

      grouped[orderNo].push({
        tariff_id: tariffId,
        charge_id: tariff.charge_id,
        description: tariff.description,
        units: qty || 1,
        amount,
      });
    }

    const preview = await Promise.all(
      Object.entries(grouped).map(async ([orderNo, charges]) => ({
        blnum: orderNo,
        charges,
        order_candidates: await findOrderCandidates(orderNo, terminal),
      }))
    );

    return NextResponse.json({
      ok: true,
      terminal,
      raw_rows: dataRows.length,
      count: preview.length,
      skipped_count: skipped.length,
      preview,
      skipped,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}