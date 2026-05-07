import { NextResponse } from "next/server";
import { calculateLateFee, getPolicyMap, type LateFeePolicy } from "@/lib/lateFeePolicies";

type McleodOrderSummary = {
  id?: string | number;
  order_id?: string | number;
  blnum?: string | null;
  revenue_code_id?: string | null;
  customer_id?: string | null;
  doc_cutoff_date?: string | null;
  bol_received?: string | null;
  bol_recv_date?: string | null;
  bill_date?: string | null;
  movement?: {
    status?: string | null;
    brokerage_status?: string | null;
  } | null;
  stops?: McleodStop[] | null;
};

type McleodStop = {
  stop_type?: string | null;
  location_id?: string | number | null;
  sched_arrive_early?: string | null;
  sched_arrive_late?: string | null;
  actual_arrival?: string | null;
  actual_departure?: string | null;
  city_name?: string | null;
  state?: string | null;
};

type LateFeeRow = {
  orderId: string;
  customerId: string;
  revenueCode: string;
  blnum: string;
  mark: string | null;
  bales: number;
  movementStatus: string;
  brokerageStatus: string;
  docCutoffDate: string | null;
  lastFreeDate: string | null;
  feeStartDate: string | null;
  anchorDateUsed: "doc_cutoff_date" | "so_sched_arrive_late" | "so_sched_arrive_early" | "none";
  rawDaysLate: number;
  graceDays: number;
  effectiveDaysLate: number;
  lateFee: number;
  policyCode: string | null;
  policyType: string | null;
  avoidableFee: boolean | null;
  policyAmount: number | null;
  soLocationId: string | null;
  soCity: string | null;
  soState: string | null;
};

const DEFAULT_LIMIT = 250;

const EXCLUDED_MOVEMENT_STATUSES = new Set(["D", "V", "P"]);
const EXCLUDED_BROKERAGE_STATUSES = new Set([
  "FINISHED",
  "RC_SENT",
  "RC_EXP",
  "PROGRESS",
  "DISPATCH",
  "COVERED",
]);

function getBaseUrl() {
  const baseUrl = process.env.MCLEOD_BASE_URL;
  if (!baseUrl) throw new Error("Missing MCLEOD_BASE_URL");
  return baseUrl.replace(/\/+$/, "");
}

function getToken() {
  const token =
    process.env.MCLEOD_API_TOKEN ||
    process.env.MCLEOD_BEARER_TOKEN ||
    process.env.MCLEOD_AUTH_TOKEN;

  if (!token) {
    throw new Error(
      "Missing MCLEOD_API_TOKEN, MCLEOD_BEARER_TOKEN, or MCLEOD_AUTH_TOKEN"
    );
  }

  return token;
}

async function mcleodFetch(path: string) {
  const url = `${getBaseUrl()}${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`McLeod request failed: ${res.status} ${res.statusText} :: ${text}`);
  }

  if (res.status === 204) return [];

  const text = await res.text();
  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getOrderId(order: McleodOrderSummary): string {
  return String(order.order_id ?? order.id ?? "").trim();
}

function getMovementStatus(order: McleodOrderSummary): string {
  return String(order.movement?.status ?? "").trim().toUpperCase();
}

function getBrokerageStatus(order: McleodOrderSummary): string {
  return String(order.movement?.brokerage_status ?? "").trim().toUpperCase();
}

function parseBales(blnumRaw: string | null | undefined): number {
  const blnum = safeString(blnumRaw);
  if (!blnum) return 0;

  const patterns = [
    /(?:^|\s)(\d+)\s*BALES?\b/i,
    /\bB\/?C\s*(\d+)\b/i,
    /\b(\d+)\s*B\/?C\b/i,
    /\bBC\s*(\d+)\b/i,
    /\b(\d+)\s*BC\b/i,
  ];

  for (const pattern of patterns) {
    const match = blnum.match(pattern);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }

  return 0;
}

function parseMark(blnumRaw: string | null | undefined): string | null {
  const blnum = safeString(blnumRaw);
  if (!blnum) return null;

  const first = blnum.split(/\s+/)[0]?.trim();
  return first ? first.toUpperCase() : null;
}

function normalizeDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;

  const raw = value.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(AM|PM))?$/i
  );

  if (!match) return null;

  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);

  let hour = 0;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
  const ampm = match[6]?.toUpperCase();

  if (match[4]) {
    hour = Number.parseInt(match[4], 10);
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
  }

  const dt = new Date(year, month, day, hour, minute, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDateFromDate(dt: Date | null): string | null {
  if (!dt) return null;

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function formatDateOnly(value: string | null | undefined): string | null {
  return formatDateFromDate(normalizeDateInput(value));
}

function addDays(date: Date | null, days: number): Date | null {
  if (!date) return null;
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffDaysLate(anchor: Date | null, today = new Date()): number {
  if (!anchor) return 0;

  const a = startOfDay(anchor);
  const t = startOfDay(today);

  const ms = t.getTime() - a.getTime();
  const days = Math.floor(ms / 86_400_000);

  return days > 0 ? days : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getSoStop(order: McleodOrderSummary): McleodStop | null {
  const stops = asArray<McleodStop>(order.stops);
  return stops.find((s) => safeString(s.stop_type).toUpperCase() === "SO") ?? null;
}

function getAnchorDate(order: McleodOrderSummary): {
  date: Date | null;
  source: LateFeeRow["anchorDateUsed"];
} {
  const cutoff = normalizeDateInput(order.doc_cutoff_date);
  if (cutoff) {
    return { date: cutoff, source: "doc_cutoff_date" };
  }

  const so = getSoStop(order);

  const late = normalizeDateInput(so?.sched_arrive_late ?? null);
  if (late) {
    return { date: late, source: "so_sched_arrive_late" };
  }

  const early = normalizeDateInput(so?.sched_arrive_early ?? null);
  if (early) {
    return { date: early, source: "so_sched_arrive_early" };
  }

  return { date: null, source: "none" };
}

function shouldKeepOrder(order: McleodOrderSummary): boolean {
  const revenueCode = safeString(order.revenue_code_id).toUpperCase();
  if (revenueCode !== "DAVIS") return false;

  const movementStatus = getMovementStatus(order);
  if (EXCLUDED_MOVEMENT_STATUSES.has(movementStatus)) return false;

  const brokerageStatus = getBrokerageStatus(order);
  if (EXCLUDED_BROKERAGE_STATUSES.has(brokerageStatus)) return false;

  const billDate = safeString(order.bill_date);
  if (billDate) return false;

  const blnum = safeString(order.blnum);
  if (!blnum) return false;

  const bales = parseBales(blnum);
  if (!bales || bales <= 0) return false;

  return true;
}

async function getCandidateOrders(limit: number): Promise<McleodOrderSummary[]> {
  const filters = [`revenue_code_id eq "DAVIS"`];

  const paths = [
    `/orders/search?filters=${encodeURIComponent(filters.join(" and "))}&limit=${limit}`,
    `/orders/search?filter=${encodeURIComponent(filters.join(" and "))}&limit=${limit}`,
    `/orders/search?revenue_code_id=${encodeURIComponent("DAVIS")}&limit=${limit}`,
    `/orders?revenue_code_id=${encodeURIComponent("DAVIS")}&limit=${limit}`,
    `/orders?limit=${limit}`,
  ];

  for (const path of paths) {
    try {
      const raw = await mcleodFetch(path);
      const rows = asArray<McleodOrderSummary>(raw);

      if (rows.length > 0) {
        return rows;
      }
    } catch {
      // Try next McLeod query format.
    }
  }

  return [];
}

async function hydrateOrder(orderId: string): Promise<McleodOrderSummary | null> {
  if (!orderId) return null;

  try {
    const raw = await mcleodFetch(`/orders/${encodeURIComponent(orderId)}`);
    if (Array.isArray(raw)) {
      return (raw[0] as McleodOrderSummary) ?? null;
    }
    return raw as McleodOrderSummary;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const limit = Number.parseInt(searchParams.get("limit") ?? "", 10) || DEFAULT_LIMIT;
    const includeZeroLate = searchParams.get("includeZeroLate") === "1";
    const includeNoPolicy = searchParams.get("includeNoPolicy") === "1";
    const debug = searchParams.get("debug") === "1";
    const testOrderId = searchParams.get("orderId");

    const policyMap = getPolicyMap();

    const baseOrders = testOrderId
      ? ([await hydrateOrder(testOrderId)].filter(Boolean) as McleodOrderSummary[])
      : await getCandidateOrders(limit);

    const likelyDallas = baseOrders.filter((o) => {
      const revenueCode = safeString(o.revenue_code_id).toUpperCase();
      return revenueCode === "DAVIS";
    });

    const detailed = await Promise.all(
      likelyDallas.map(async (o) => {
        const orderId = getOrderId(o);
        if (!orderId) return null;
        const full = await hydrateOrder(orderId);
        return full ?? o;
      })
    );

    const filtered = detailed
      .filter((o): o is McleodOrderSummary => !!o)
      .filter(shouldKeepOrder);

    const mappedRows = filtered.map((order) => {
      const orderId = getOrderId(order);
      const revenueCode = safeString(order.revenue_code_id).toUpperCase();
      const blnum = safeString(order.blnum);
      const bales = parseBales(blnum);
      const so = getSoStop(order);
      const anchor = getAnchorDate(order);
      const rawDaysLate = diffDaysLate(anchor.date);

      const locationId =
        so?.location_id !== undefined && so?.location_id !== null
          ? String(so.location_id).trim()
          : null;

      const policy: LateFeePolicy | undefined = locationId
        ? policyMap.get(locationId)
        : undefined;

      /**
       * DAVIS rule:
       * doc_cutoff_date is already the last free day.
       * Do NOT subtract policy grace days when doc_cutoff_date is used.
       */
      const graceDays =
        revenueCode === "DAVIS" && anchor.source === "doc_cutoff_date"
          ? 0
          : Number(policy?.late_load_grace_days ?? 0);

      const effectiveDaysLate = Math.max(0, rawDaysLate - graceDays);
      const lateFee = round2(calculateLateFee(policy, bales, effectiveDaysLate));

      const lastFreeAnchorDate =
        anchor.source === "doc_cutoff_date"
          ? normalizeDateInput(order.doc_cutoff_date)
          : anchor.source === "so_sched_arrive_late"
            ? normalizeDateInput(so?.sched_arrive_late ?? null)
            : anchor.source === "so_sched_arrive_early"
              ? normalizeDateInput(so?.sched_arrive_early ?? null)
              : null;

      const lastFreeDate = formatDateFromDate(lastFreeAnchorDate);
      const feeStartDate =
        effectiveDaysLate > 0 ? formatDateFromDate(addDays(lastFreeAnchorDate, 1)) : null;

      const row: LateFeeRow = {
        orderId,
        customerId: safeString(order.customer_id),
        revenueCode,
        blnum,
        mark: parseMark(blnum),
        bales,
        movementStatus: getMovementStatus(order),
        brokerageStatus: getBrokerageStatus(order),
        docCutoffDate: formatDateOnly(order.doc_cutoff_date),
        lastFreeDate,
        feeStartDate,
        anchorDateUsed: anchor.source,
        rawDaysLate,
        graceDays,
        effectiveDaysLate,
        lateFee,
        policyCode: locationId,
        policyType: policy?.fee_type ?? null,
        avoidableFee: typeof policy?.avoidable_fee === "boolean" ? policy.avoidable_fee : null,
        policyAmount: typeof policy?.amount === "number" ? policy.amount : null,
        soLocationId: locationId,
        soCity: safeString(so?.city_name),
        soState: safeString(so?.state),
      };

      return {
        row,
        hasPolicy: !!policy,
      };
    });

    const rows = mappedRows
      .filter(({ row, hasPolicy }) => {
        if (!includeNoPolicy && !hasPolicy) return false;
        if (!includeZeroLate && row.effectiveDaysLate <= 0) return false;
        return true;
      })
      .map(({ row }) => row)
      .sort((a, b) => {
        if (b.effectiveDaysLate !== a.effectiveDaysLate) {
          return b.effectiveDaysLate - a.effectiveDaysLate;
        }
        return b.lateFee - a.lateFee;
      });

    const totals = rows.reduce(
      (acc, row) => {
        acc.orders += 1;
        acc.totalBales += row.bales;
        acc.totalLateFees = round2(acc.totalLateFees + row.lateFee);
        acc.totalRawDaysLate += row.rawDaysLate;
        acc.totalEffectiveDaysLate += row.effectiveDaysLate;
        return acc;
      },
      {
        orders: 0,
        totalBales: 0,
        totalLateFees: 0,
        totalRawDaysLate: 0,
        totalEffectiveDaysLate: 0,
      }
    );

    const avgEffectiveDaysLate =
      totals.orders > 0 ? round2(totals.totalEffectiveDaysLate / totals.orders) : 0;

    const policyMatchedCount = mappedRows.filter((x) => x.hasPolicy).length;
    const policyMissingCount = mappedRows.length - policyMatchedCount;

    return NextResponse.json({
      ok: true,
      office: "Dallas",
      matchingKey: "SO.location_id => policy.mcleod_code",
      assumptions: {
        revenueCode: "DAVIS",
        excludedMovementStatuses: Array.from(EXCLUDED_MOVEMENT_STATUSES),
        excludedBrokerageStatuses: Array.from(EXCLUDED_BROKERAGE_STATUSES),
        anchorDatePriority: [
          "doc_cutoff_date",
          "SO stop sched_arrive_late",
          "SO stop sched_arrive_early",
        ],
        notes: [
          "This route calculates current late fee exposure for Dallas.",
          "Policies are matched by SO.location_id.",
          "For DAVIS, doc_cutoff_date is treated as the last free day.",
          "Grace days are NOT subtracted when doc_cutoff_date is used.",
          "Grace days are only used when fallback SO scheduled dates are used.",
          "Billed orders are excluded when bill_date is present.",
          "By default, rows without a matching policy are excluded.",
        ],
      },
      totals: {
        ...totals,
        avgEffectiveDaysLate,
      },
      count: rows.length,
      rows,
      ...(debug
        ? {
            debug: {
              mode: testOrderId ? "single_order_test" : "candidate_search",
              testedOrderId: testOrderId,
              fetchedOrderSummaries: baseOrders.length,
              likelyDallasSummaries: likelyDallas.length,
              hydratedAndKept: filtered.length,
              mappedRowsBeforeFinalFilters: mappedRows.length,
              policyMatchedCount,
              policyMissingCount,
              includedRows: rows.length,
            },
          }
        : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}