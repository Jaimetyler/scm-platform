import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { officeConfigs } from "@/lib/late-fees/officeConfigs";
import type { McleodOrderSummary } from "@/lib/late-fees/types";
import { getOrderId } from "@/lib/late-fees/orderHelpers";
import { parseBales, parseMark, safeString } from "@/lib/late-fees/utils";
import { getPolicyLocationId } from "@/lib/late-fees/engine";
import { getPolicyMap } from "@/lib/lateFeePolicies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_QUERIES = [
  "ADMCLUTX",
  "ECOMDATX",
  "BACOMCTX",
  "GLENSTCT",
  "OLAMRITX",
  "STAPGRMS",
  "ALLECOTN",
  "CTCLSAGA",
  "TOYODATX",
  "SCRESYGA",
  "OMNIPLTX",
  "BRIGRITX",
  "WHITBACA",
  "NOBLHOTX",
  "UNIOCOGA",
  "SUPPGAGA",
  "AMERBRTN",
  "ROBENATN",
  "MEMTLUTX",
  "VITEOMNE",
  "BUNGOMNE",
  "TERRLUTX",
  "GOETDATX",
  "RSMCCHNC",
  "EDFMHOTX",
];

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  if (!token) throw new Error("Missing McLeod token");
  return token;
}

async function mcleodGet(path: string) {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`McLeod GET ${path} failed: ${res.status} ${text}`);
  }

  if (res.status === 204) return [];

  const text = await res.text();
  if (!text) return [];

  return JSON.parse(text);
}

async function searchOrders(q: string, limit: number): Promise<McleodOrderSummary[]> {
  const raw = await mcleodGet(
    `/orders?q=${encodeURIComponent(q)}&limit=${limit}`
  );

  return Array.isArray(raw) ? (raw as McleodOrderSummary[]) : [];
}

async function hydrateOrder(orderId: string): Promise<McleodOrderSummary | null> {
  const raw = await mcleodGet(`/orders/${encodeURIComponent(orderId)}`);
  return Array.isArray(raw) ? raw[0] ?? null : (raw as McleodOrderSummary);
}

function getStop(order: McleodOrderSummary, stopType: "PU" | "SO") {
  const stops = Array.isArray(order.stops) ? order.stops : [];
  return stops.find((s) => safeString(s.stop_type).toUpperCase() === stopType) ?? null;
}

function buildSnapshot(order: McleodOrderSummary) {
  const config = officeConfigs.savannah;
  const policyMap = getPolicyMap();

  const orderId = getOrderId(order);
  const blnum = safeString(order.blnum);
  const pu = getStop(order, "PU");
  const so = getStop(order, "SO");

  const policyCode = getPolicyLocationId(order, config);
  const policy = policyCode ? policyMap.get(policyCode) : undefined;

  const movement = Array.isArray(order.movements) ? order.movements[0] : order.movement;

  return {
    office: config.office,
    order_id: orderId,
    revenue_code_id: safeString(order.revenue_code_id).toUpperCase(),
    customer_id: safeString(order.customer_id),
    blnum,
    mark: parseMark(blnum),
    bales: parseBales(blnum),

    movement_status: safeString(movement?.status).toUpperCase(),
    brokerage_status: safeString(movement?.brokerage_status).toUpperCase(),
    order_status: safeString(order.status).toUpperCase(),
    bill_date: safeString(order.bill_date) || null,

    doc_cutoff_date: safeString(order.doc_cutoff_date) || null,

    pu_location_id:
      pu?.location_id !== undefined && pu?.location_id !== null
        ? String(pu.location_id).trim()
        : null,
    pu_city: safeString(pu?.city_name) || null,
    pu_state: safeString(pu?.state) || null,

    so_location_id:
      so?.location_id !== undefined && so?.location_id !== null
        ? String(so.location_id).trim()
        : null,
    so_city: safeString(so?.city_name) || null,
    so_state: safeString(so?.state) || null,

    policy_code: policyCode,
    policy_type: policy?.fee_type ?? null,
    policy_amount: policy?.amount ?? null,
    avoidable_fee:
      typeof policy?.avoidable_fee === "boolean" ? policy.avoidable_fee : null,

    raw_order: order,
    synced_at: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const config = officeConfigs.savannah;

    const body = await req.json().catch(() => ({}));
    const limit = Number.parseInt(String(body.limit ?? "100"), 10) || 100;
    const q = String(body.q ?? config.revenueCodes[0] ?? "MAIN");

   const requestedQ =
  typeof body.q === "string" && body.q.trim()
    ? body.q.trim()
    : null;

const queries = requestedQ
  ? [requestedQ]
  : DEFAULT_QUERIES;

const summaryMap = new Map<string, McleodOrderSummary>();

for (const query of queries) {
  const found = await searchOrders(query, limit);

  for (const order of found) {
    const orderId = getOrderId(order);

    if (!orderId) continue;

    if (!summaryMap.has(orderId)) {
      summaryMap.set(orderId, order);
    }
  }
}

const summaries = Array.from(summaryMap.values());

    const candidates = summaries.filter((order) => {
      const revenueCode = safeString(order.revenue_code_id).toUpperCase();
      const orderStatus = safeString(order.status).toUpperCase();

      return (
        config.revenueCodes.includes(revenueCode) &&
        !config.excludedMovementStatuses.includes(orderStatus)
      );
    });

    const results = [];

    for (const candidate of candidates) {
      const orderId = getOrderId(candidate);

      if (!orderId) {
        results.push({
          orderId: null,
          ok: false,
          error: "Missing order id",
        });
        continue;
      }

      try {
        const fullOrder = await hydrateOrder(orderId);

        const commodityId = safeString(fullOrder?.commodity_id).toUpperCase();
const commodity = safeString(fullOrder?.commodity).toUpperCase();

const isCotton =
  commodityId === "COTTON" ||
  commodity.includes("COTTON");

if (!isCotton) {
  results.push({
    orderId,
    ok: false,
    skipped: true,
    reason: "not cotton",
    commodityId,
    commodity,
  });

  continue;
}

        if (!fullOrder) {
          results.push({
            orderId,
            ok: false,
            error: "Hydration returned no order",
          });
          continue;
        }

        const snapshot = buildSnapshot(fullOrder);

        const cutoff = fullOrder.doc_cutoff_date
  ? new Date(
      fullOrder.doc_cutoff_date.replace(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/,
        "$1-$2-$3T$4:$5:$6$7"
      )
    )
  : null;

const today = new Date();
const cutoffDay = cutoff
  ? new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate())
  : null;
const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

if (!cutoffDay || cutoffDay.getTime() > todayDay.getTime()) {
  results.push({
    orderId,
    ok: false,
    skipped: true,
    reason: "not in exposure window",
    docCutoffDate: fullOrder.doc_cutoff_date ?? null,
  });
  continue;
}

        const { error } = await supabase
          .from("late_fee_order_snapshots")
          .upsert(snapshot, {
            onConflict: "office,order_id",
          });

        if (error) {
          results.push({
            orderId,
            ok: false,
            error: error.message,
          });
          continue;
        }

        results.push({
          orderId,
          ok: true,
          revenueCode: snapshot.revenue_code_id,
          status: snapshot.order_status,
          customerId: snapshot.customer_id,
          blnum: snapshot.blnum,
          bales: snapshot.bales,
          policyCode: snapshot.policy_code,
          policyType: snapshot.policy_type,
        });
      } catch (error) {
        results.push({
          orderId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      office: config.office,
      queries,
      limit,
      searched: summaries.length,
      candidates: candidates.length,
      saved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
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