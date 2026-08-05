import { NextRequest, NextResponse } from "next/server";

import {
  calculateLateFee,
  getPolicyMap,
  type LateFeePolicy,
} from "@/lib/lateFeePolicies";

import { round2 } from "@/lib/late-fees/utils";

export const runtime = "nodejs";

type MonthlyStatus = "ok" | "missing_data" | "not_late" | "no_policy";

function safeString(value: unknown): string {
  return String(value ?? "").trim();
}

function parseNumber(value: unknown): number | null {
  const raw = safeString(value).replace(/,/g, "");

  if (!raw) return null;

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);

  return out;
}

function parseCsv(text: string): Record<string, string>[] {
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
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] =
        values[index]?.trim().replace(/^"|"$/g, "") ?? "";
    });

    return row;
  });
}

function getValue(
  row: Record<string, string>,
  keys: string[]
): string {
  for (const key of keys) {
    const exactValue = row[key];

    if (
      exactValue !== undefined &&
      safeString(exactValue)
    ) {
      return safeString(exactValue);
    }

    const matchingKey = Object.keys(row).find(
      (rowKey) =>
        rowKey.trim().toLowerCase() === key.trim().toLowerCase()
    );

    if (
      matchingKey &&
      safeString(row[matchingKey])
    ) {
      return safeString(row[matchingKey]);
    }
  }

  return "";
}

function dateOnly(value: unknown): string | null {
  const raw = safeString(value);

  if (!raw) return null;

  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(
      /(\d{1,2}):(\d{2})(AM|PM)$/i,
      "$1:$2 $3"
    )
    .trim();

  const mdy = cleaned.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/
  );

  if (mdy) {
    const month = mdy[1].padStart(2, "0");
    const day = mdy[2].padStart(2, "0");
    const year =
      mdy[3].length === 2
        ? `20${mdy[3]}`
        : mdy[3];

    return `${year}-${month}-${day}`;
  }

  const ymd = cleaned.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})/
  );

  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(
      2,
      "0"
    )}-${ymd[3].padStart(2, "0")}`;
  }

  const direct = new Date(cleaned);

  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  return null;
}

function diffDays(
  start: string | null,
  end: string | null
): number | null {
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
    (endDate.getTime() - startDate.getTime()) /
      86_400_000
  );
}

function parseBalesFromBlnum(
  blnum: unknown
): number | null {
  const raw = safeString(blnum).toUpperCase();
  const match = raw.match(/(\d+)\s*BALES?/);

  if (!match) return null;

  const parsed = Number(match[1]);

  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(
  date: string | null,
  days: number
): string | null {
  if (!date) return null;

  const parsedDate = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  parsedDate.setDate(parsedDate.getDate() + days);

  return parsedDate.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const policyMap = getPolicyMap();

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing file",
        },
        {
          status: 400,
        }
      );
    }

    const csvText = await file.text();
    const csvRows = parseCsv(csvText);

    if (csvRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "The CSV did not contain any data rows.",
        },
        {
          status: 400,
        }
      );
    }

    const rows = csvRows.map((r, index) => {
      /*
       * The Savannah monthly export does not currently
       * contain a traditional order ID. It does contain
       * the cotton mark, so mark is used as the row ID.
       */
      const orderId = getValue(r, [
        "order_id",
        "id",
        "Order",
        "ORDER",
        "mark",
        "Mark",
      ]);

      const customer = getValue(r, [
        "customer_id",
        "customer",
        "Customer",
      ]);

      const revenueCode = getValue(r, [
        "revenue_code_id",
        "revenueCode",
        "revenue_code",
      ]).toUpperCase();

      const commodityId = getValue(r, [
        "commodity_id",
        "commodity",
        "commodityId",
      ]).toUpperCase();

      const blnum = getValue(r, [
        "blnum",
        "bl_num",
        "BOL",
        "bol",
      ]);

      /*
       * First read the dedicated bale-count column.
       * Fall back to parsing the BOL field only when
       * the dedicated column is unavailable.
       */
      const baleCountValue = getValue(r, [
        "bale_count",
        "Bale_Count",
        "Bale Count",
        "bales",
        "Bales",
      ]);

      const baleCountFromColumn =
        parseNumber(baleCountValue);

      const baleCount =
        baleCountFromColumn ??
        parseBalesFromBlnum(blnum);

      const locationCode = getValue(r, [
        "pu_location_id",
        "locationCode",
        "location_code",
        "Location_Code",
        "Location Code",
      ]).toUpperCase();

      const actualPickup = dateOnly(
        getValue(r, [
          "pu_actual_arrival",
          "actualPickup",
          "actual_pickup",
          "Actual_Pickup",
          "Actual Pickup",
        ])
      );

      const actualDelivery = dateOnly(
        getValue(r, [
          "so_actual_arrival",
          "actualDelivery",
          "actual_delivery",
          "Actual_Delivery",
          "Actual Delivery",
        ])
      );

      const originalDate = dateOnly(
        getValue(r, [
          "doc_cutoff_date",
          "originalDate",
          "original_date",
          "Original_Date",
          "Original Date",
          "Original Date Doc Cut",
        ])
      );

      /*
       * Use the days_late column from the monthly export
       * when present. Otherwise calculate it from the
       * original date and actual delivery date.
       */
      const providedDaysLate = parseNumber(
        getValue(r, [
          "days_late",
          "daysLate",
          "Days_Late",
          "Days Late",
        ])
      );

      const calculatedDaysLate = diffDays(
        originalDate,
        actualDelivery
      );

      const rawDaysLate =
        providedDaysLate ?? calculatedDaysLate;

      const policy: LateFeePolicy | undefined =
        locationCode
          ? policyMap.get(locationCode)
          : undefined;

      const graceDays = Number(
        policy?.late_load_grace_days ?? 0
      );

      const effectiveDaysLate =
        rawDaysLate === null
          ? null
          : Math.max(0, rawDaysLate - graceDays);

      const lateFee =
        policy &&
        baleCount !== null &&
        effectiveDaysLate !== null
          ? round2(
              calculateLateFee(
                policy,
                baleCount,
                effectiveDaysLate
              )
            )
          : 0;

      let status: MonthlyStatus = "ok";
      let reason: string | undefined;

      if (
        !orderId ||
        !customer ||
        !locationCode ||
        baleCount === null ||
        !actualDelivery ||
        !originalDate ||
        rawDaysLate === null
      ) {
        status = "missing_data";
        reason =
          "Missing mark/order, customer, location, bale count, actual delivery, original date, or days late";
      } else if (!policy) {
        status = "no_policy";
        reason = `No late fee policy found for location ${locationCode}`;
      } else if (
        effectiveDaysLate !== null &&
        effectiveDaysLate <= 0
      ) {
        status = "not_late";
        reason =
          "Delivered on or before the fee start date";
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
          effectiveDaysLate !== null &&
          effectiveDaysLate > 0
            ? addDays(
                originalDate,
                graceDays + 1
              )
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

    const includedRows = rows.filter(
      (row) => row.status === "ok"
    );

    const totals = includedRows.reduce(
      (acc, row) => {
        acc.orders += 1;
        acc.totalBales += row.baleCount ?? 0;
        acc.totalRawDaysLate +=
          row.rawDaysLate ?? 0;
        acc.totalEffectiveDaysLate +=
          row.effectiveDaysLate ?? 0;
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

    const customerSummaryMap = new Map<
      string,
      {
        customer: string;
        orders: number;
        bales: number;
        totalLateFees: number;
        ok: number;
        missingData: number;
        noPolicy: number;
        notLate: number;
      }
    >();

    for (const row of rows) {
      const key = row.customer || "UNKNOWN";

      const existing =
        customerSummaryMap.get(key) ?? {
          customer: key,
          orders: 0,
          bales: 0,
          totalLateFees: 0,
          ok: 0,
          missingData: 0,
          noPolicy: 0,
          notLate: 0,
        };

      existing.orders += 1;
      existing.bales += row.baleCount ?? 0;

      if (row.status === "ok") {
        existing.totalLateFees +=
          row.lateFee ?? 0;
        existing.ok += 1;
      }

      if (row.status === "missing_data") {
        existing.missingData += 1;
      }

      if (row.status === "no_policy") {
        existing.noPolicy += 1;
      }

      if (row.status === "not_late") {
        existing.notLate += 1;
      }

      customerSummaryMap.set(key, existing);
    }

    const customerSummary = Array.from(
      customerSummaryMap.values()
    )
      .map((item) => ({
        ...item,
        totalLateFees: round2(
          item.totalLateFees
        ),
      }))
      .sort(
        (a, b) =>
          b.totalLateFees - a.totalLateFees
      );

    const locationSummaryMap = new Map<
      string,
      {
        locationCode: string;
        orders: number;
        bales: number;
        totalLateFees: number;
        ok: number;
        missingData: number;
        noPolicy: number;
        notLate: number;
        policyType: string | null;
        policyAmount: number | null;
        graceDays: number | null;
      }
    >();

    for (const row of rows) {
      const key =
        row.locationCode || "UNKNOWN";

      const existing =
        locationSummaryMap.get(key) ?? {
          locationCode: key,
          orders: 0,
          bales: 0,
          totalLateFees: 0,
          ok: 0,
          missingData: 0,
          noPolicy: 0,
          notLate: 0,
          policyType:
            row.policyType ?? null,
          policyAmount:
            row.policyAmount ?? null,
          graceDays:
            row.graceDays ?? null,
        };

      existing.orders += 1;
      existing.bales += row.baleCount ?? 0;

      if (row.status === "ok") {
        existing.totalLateFees +=
          row.lateFee ?? 0;
        existing.ok += 1;
      }

      if (row.status === "missing_data") {
        existing.missingData += 1;
      }

      if (row.status === "no_policy") {
        existing.noPolicy += 1;
      }

      if (row.status === "not_late") {
        existing.notLate += 1;
      }

      locationSummaryMap.set(key, existing);
    }

    const locationSummary = Array.from(
      locationSummaryMap.values()
    )
      .map((item) => ({
        ...item,
        totalLateFees: round2(
          item.totalLateFees
        ),
      }))
      .sort((a, b) => {
        if (b.noPolicy !== a.noPolicy) {
          return b.noPolicy - a.noPolicy;
        }

        return (
          b.totalLateFees -
          a.totalLateFees
        );
      });

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      source: "monthly_sql_csv",
      csvRows: csvRows.length,
      debugHeaders: csvRows[0]
        ? Object.keys(csvRows[0])
        : [],
      debugFirstRow: csvRows[0] ?? null,
      totalRows: rows.length,
      summary: {
        ok: rows.filter(
          (row) => row.status === "ok"
        ).length,
        missingData: rows.filter(
          (row) =>
            row.status === "missing_data"
        ).length,
        noPolicy: rows.filter(
          (row) => row.status === "no_policy"
        ).length,
        notLate: rows.filter(
          (row) => row.status === "not_late"
        ).length,
      },
      totals: {
        ...totals,
        totalBales: round2(
          totals.totalBales
        ),
        totalLateFees: round2(
          totals.totalLateFees
        ),
      },
      customerSummary,
      locationSummary,
      missingPolicyLocations:
        locationSummary.filter(
          (item) => item.noPolicy > 0
        ),
      rows,
    });
  } catch (error) {
    console.error(
      "Savannah monthly preview failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status: 500,
      }
    );
  }
}