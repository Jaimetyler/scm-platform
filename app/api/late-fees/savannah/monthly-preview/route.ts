import { withStaffAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";

import {
  calculateLateFee,
  getPolicyMap,
  type LateFeePolicy,
} from "@/lib/lateFeePolicies";

import { round2 } from "@/lib/late-fees/utils";

export const runtime = "nodejs";

type MonthlyStatus = "ok" | "missing_data" | "not_late" | "no_policy";
type CsvRow = Record<string, string>;

function safeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(value: string): string {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseNumber(value: unknown): number | null {
  const raw = safeString(value).replace(/,/g, "");
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current);
  return out;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) =>
    header.trim().replace(/^"|"$/g, "")
  );

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};

    headers.forEach((header, index) => {
      const value = values[index]?.trim().replace(/^"|"$/g, "") ?? "";
      row[header] = value;
      row[normalizeHeader(header)] = value;
    });

    return row;
  });
}

function getValue(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const exact = row[key];
    if (exact !== undefined && safeString(exact)) return safeString(exact);

    const normalized = row[normalizeHeader(key)];
    if (normalized !== undefined && safeString(normalized)) {
      return safeString(normalized);
    }
  }

  return "";
}

function dateOnly(value: unknown): string | null {
  const raw = safeString(value);
  if (!raw) return null;

  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/(\d{1,2}):(\d{2})(AM|PM)$/i, "$1:$2 $3")
    .trim();

  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdy) {
    const month = mdy[1].padStart(2, "0");
    const day = mdy[2].padStart(2, "0");
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${year}-${month}-${day}`;
  }

  const ymd = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function diffDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;

  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return null;
  }

  return Math.floor(
    (endDate.getTime() - startDate.getTime()) / 86_400_000
  );
}

function parseBalesFromBlnum(blnum: unknown): number | null {
  const raw = safeString(blnum).toUpperCase();
  const match = raw.match(/(\d+)\s*BALES?/);

  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(date: string | null, days: number): string | null {
  if (!date) return null;

  const parsedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;

  parsedDate.setDate(parsedDate.getDate() + days);
  return parsedDate.toISOString().slice(0, 10);
}

async function POSTHandler(req: NextRequest) {
  try {
    const policyMap = getPolicyMap();

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing file" },
        { status: 400 }
      );
    }

    const csvRows = parseCsv(await file.text());

    if (csvRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "The CSV did not contain any data rows." },
        { status: 400 }
      );
    }

    const detectedHeaders = Object.keys(csvRows[0]).filter(
      (header) => header !== normalizeHeader(header)
    );

    const requiredChecks = [
      {
        name: "customer",
        found: csvRows.some((row) =>
          Boolean(getValue(row, ["customer_id", "customer", "Customer"]))
        ),
      },
      {
        name: "location",
        found: csvRows.some((row) =>
          Boolean(
            getValue(row, [
              "pu_location_id",
              "locationCode",
              "location_code",
              "Location_Code",
              "Location Code",
            ])
          )
        ),
      },
      {
        name: "bale count",
        found: csvRows.some((row) =>
          Boolean(
            getValue(row, [
              "bale_count",
              "Bale_Count",
              "Bale Count",
              "bales",
              "Bales",
              "blnum",
              "bl_num",
              "BOL",
              "bol",
            ])
          )
        ),
      },
      {
        name: "actual delivery",
        found: csvRows.some((row) =>
          Boolean(
            getValue(row, [
              "so_actual_arrival",
              "actualDelivery",
              "actual_delivery",
              "Actual_Delivery",
              "Actual Delivery",
            ])
          )
        ),
      },
      {
        name: "original date",
        found: csvRows.some((row) =>
          Boolean(
            getValue(row, [
              "doc_cutoff_date",
              "originalDate",
              "original_date",
              "Original_Date",
              "Original Date",
              "Original Date Doc Cut",
            ])
          )
        ),
      },
    ];

    const missingRequiredFields = requiredChecks
      .filter((item) => !item.found)
      .map((item) => item.name);

    if (missingRequiredFields.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Required CSV columns are missing.",
          missingRequiredFields,
          detectedHeaders,
        },
        { status: 400 }
      );
    }

    const rows = csvRows.map((row, index) => {
      const orderId = getValue(row, [
        "order_id",
        "id",
        "Order",
        "ORDER",
        "mark",
        "Mark",
      ]);

      const customer = getValue(row, [
        "customer_id",
        "customer",
        "Customer",
      ]);

      const revenueCode = getValue(row, [
        "revenue_code_id",
        "revenueCode",
        "revenue_code",
      ]).toUpperCase();

      const commodityId = getValue(row, [
        "commodity_id",
        "commodity",
        "commodityId",
      ]).toUpperCase();

      const blnum = getValue(row, ["blnum", "bl_num", "BOL", "bol"]);

      const baleCount =
        parseNumber(
          getValue(row, [
            "bale_count",
            "Bale_Count",
            "Bale Count",
            "bales",
            "Bales",
          ])
        ) ?? parseBalesFromBlnum(blnum);

      const locationCode = getValue(row, [
        "pu_location_id",
        "locationCode",
        "location_code",
        "Location_Code",
        "Location Code",
      ]).toUpperCase();

      const actualPickup = dateOnly(
        getValue(row, [
          "pu_actual_arrival",
          "actualPickup",
          "actual_pickup",
          "Actual_Pickup",
          "Actual Pickup",
        ])
      );

      const actualDelivery = dateOnly(
        getValue(row, [
          "so_actual_arrival",
          "actualDelivery",
          "actual_delivery",
          "Actual_Delivery",
          "Actual Delivery",
        ])
      );

      const originalDate = dateOnly(
        getValue(row, [
          "doc_cutoff_date",
          "originalDate",
          "original_date",
          "Original_Date",
          "Original Date",
          "Original Date Doc Cut",
        ])
      );

      const rawDaysLate =
        parseNumber(
          getValue(row, [
            "days_late",
            "daysLate",
            "Days_Late",
            "Days Late",
          ])
        ) ?? diffDays(originalDate, actualDelivery);

      const policy: LateFeePolicy | undefined = locationCode
        ? policyMap.get(locationCode)
        : undefined;

      const graceDays = Number(policy?.late_load_grace_days ?? 0);

      const effectiveDaysLate =
        rawDaysLate === null
          ? null
          : Math.max(0, rawDaysLate - graceDays);

      const lateFee =
        policy &&
        baleCount !== null &&
        effectiveDaysLate !== null
          ? round2(
              calculateLateFee(policy, baleCount, effectiveDaysLate)
            )
          : 0;

      let status: MonthlyStatus = "ok";
      let reason: string | undefined;

      const missingFields = [
        !orderId ? "mark/order" : null,
        !customer ? "customer" : null,
        !locationCode ? "location" : null,
        baleCount === null ? "bale count" : null,
        !actualDelivery ? "actual delivery" : null,
        !originalDate ? "original date" : null,
        rawDaysLate === null ? "days late" : null,
      ].filter((value): value is string => Boolean(value));

      if (missingFields.length > 0) {
        status = "missing_data";
        reason = `Missing ${missingFields.join(", ")}`;
      } else if (!policy) {
        status = "no_policy";
        reason = `No late fee policy found for location ${locationCode}`;
      } else if (
        effectiveDaysLate !== null &&
        effectiveDaysLate <= 0
      ) {
        status = "not_late";
        reason = "Delivered on or before the fee start date";
      }

      return {
        rowNumber: index + 2,
        orderId,
        customer,
        revenueCode,
        commodityId,
        locationCode,
        blnum,
        baleCount,
        actualPickup,
        actualDelivery,
        originalDate,
        rawDaysLate,
        graceDays,
        effectiveDaysLate,
        lateFee,
        feeStartDate:
          effectiveDaysLate !== null && effectiveDaysLate > 0
            ? addDays(originalDate, graceDays + 1)
            : null,
        policyCode: locationCode,
        policyType: policy?.fee_type ?? null,
        policyAmount: policy?.amount ?? null,
        avoidableFee:
          typeof policy?.avoidable_fee === "boolean"
            ? policy.avoidable_fee
            : null,
        status,
        reason,
      };
    });

    const includedRows = rows.filter((row) => row.status === "ok");
    const exceptionRows = rows.filter((row) => row.status !== "ok");

    const totals = includedRows.reduce(
      (acc, row) => {
        acc.orders += 1;
        acc.totalBales += row.baleCount ?? 0;
        acc.totalRawDaysLate += row.rawDaysLate ?? 0;
        acc.totalEffectiveDaysLate += row.effectiveDaysLate ?? 0;
        acc.totalLateFees += row.lateFee ?? 0;
        return acc;
      },
      {
        orders: 0,
        totalBales: 0,
        totalRawDaysLate: 0,
        totalEffectiveDaysLate: 0,
        totalLateFees: 0,
      }
    );

    const customerSummaryMap = new Map<string, any>();
    const locationSummaryMap = new Map<string, any>();

    for (const row of rows) {
      const customerKey = row.customer || "UNKNOWN";
      const customerItem =
        customerSummaryMap.get(customerKey) ?? {
          customer: customerKey,
          orders: 0,
          bales: 0,
          totalLateFees: 0,
          ok: 0,
          missingData: 0,
          noPolicy: 0,
          notLate: 0,
        };

      customerItem.orders += 1;
      customerItem.bales += row.baleCount ?? 0;

      if (row.status === "ok") {
        customerItem.totalLateFees += row.lateFee ?? 0;
        customerItem.ok += 1;
      }
      if (row.status === "missing_data") customerItem.missingData += 1;
      if (row.status === "no_policy") customerItem.noPolicy += 1;
      if (row.status === "not_late") customerItem.notLate += 1;

      customerSummaryMap.set(customerKey, customerItem);

      const locationKey = row.locationCode || "UNKNOWN";
      const locationItem =
        locationSummaryMap.get(locationKey) ?? {
          locationCode: locationKey,
          orders: 0,
          bales: 0,
          totalLateFees: 0,
          ok: 0,
          missingData: 0,
          noPolicy: 0,
          notLate: 0,
          policyType: row.policyType ?? null,
          policyAmount: row.policyAmount ?? null,
          graceDays: row.graceDays ?? null,
        };

      locationItem.orders += 1;
      locationItem.bales += row.baleCount ?? 0;

      if (row.status === "ok") {
        locationItem.totalLateFees += row.lateFee ?? 0;
        locationItem.ok += 1;
      }
      if (row.status === "missing_data") locationItem.missingData += 1;
      if (row.status === "no_policy") locationItem.noPolicy += 1;
      if (row.status === "not_late") locationItem.notLate += 1;

      locationSummaryMap.set(locationKey, locationItem);
    }

    const customerSummary = Array.from(customerSummaryMap.values())
      .map((item) => ({
        ...item,
        totalLateFees: round2(item.totalLateFees),
      }))
      .sort((a, b) => b.totalLateFees - a.totalLateFees);

    const locationSummary = Array.from(locationSummaryMap.values())
      .map((item) => ({
        ...item,
        totalLateFees: round2(item.totalLateFees),
      }))
      .sort((a, b) => {
        if (b.noPolicy !== a.noPolicy) return b.noPolicy - a.noPolicy;
        return b.totalLateFees - a.totalLateFees;
      });

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      source: "monthly_sql_csv",
      detectedHeaders,
      importedRows: rows.length,
      billableRows: includedRows.length,
      skippedRows: exceptionRows.length,
      summary: {
        ok: includedRows.length,
        missingData: rows.filter((row) => row.status === "missing_data").length,
        noPolicy: rows.filter((row) => row.status === "no_policy").length,
        notLate: rows.filter((row) => row.status === "not_late").length,
      },
      totals: {
        ...totals,
        totalBales: round2(totals.totalBales),
        totalLateFees: round2(totals.totalLateFees),
      },
      customerSummary,
      locationSummary,
      missingPolicyLocations: locationSummary.filter(
        (item) => item.noPolicy > 0
      ),
      exceptionRows,
      rows,
    });
  } catch (error) {
    console.error("Savannah monthly preview failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const POST = withStaffAccess(POSTHandler);
