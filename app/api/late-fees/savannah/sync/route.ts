import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPolicyMap, type LateFeePolicy } from "@/lib/lateFeePolicies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



type McleodStop = {
  stop_type?: string | null;
  location_id?: string | number | null;
  city_name?: string | null;
  state?: string | null;
};

type McleodOrder = {
  id?: string | number;
  order_id?: string | number;
  blnum?: string | null;
  revenue_code_id?: string | null;
  customer_id?: string | null;
  doc_cutoff_date?: string | null;
  bill_date?: string | null;
  status?: string | null;
  movement?: {
    status?: string | null;
    brokerage_status?: string | null;
  } | null;
  movements?: Array<{
    status?: string | null;
    brokerage_status?: string | null;
  }> | null;
  stops?: McleodStop[] | null;
};

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

  if (!token) {
    throw new Error(
      "Missing MCLEOD_API_TOKEN, MCLEOD_BEARER_TOKEN, or MCLEOD_AUTH_TOKEN"
    );
  }

  return token;
}

async function mcleodFetchOrder(orderId: string): Promise<McleodOrder | null> {
  const url = `${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`;

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
    throw new Error(`McLeod order ${orderId} failed: ${res.status} ${text}`);
  }

  const text = await res.text();
  if (!text) return null;

  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed[0] ?? null : parsed;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getOrderId(order: McleodOrder): string {
  return String(order.order_id ?? order.id ?? "").trim();
}

function getStop(order: McleodOrder, stopType: "PU" | "SO"): McleodStop | null {
  const stops = asArray<McleodStop>(order.stops);
  return stops.find((s) => safeString(s.stop_type).toUpperCase() === stopType) ?? null;
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

function getMovementStatus(order: McleodOrder): string {
  return safeString(order.movement?.status || order.movements?.[0]?.status).toUpperCase();
}

function getBrokerageStatus(order: McleodOrder): string {
  return safeString(
    order.movement?.brokerage_status || order.movements?.[0]?.brokerage_status
  ).toUpperCase();
}

function getPolicy(order: McleodOrder): {
  policyCode: string | null;
  policy: LateFeePolicy | undefined;
} {
  const policyMap = getPolicyMap();
  const revenueCode = safeString(order.revenue_code_id).toUpperCase();

  const policyStop = revenueCode === "MAIN" ? getStop(order, "PU") : getStop(order, "SO");

  const policyCode =
    policyStop?.location_id !== undefined && policyStop?.location_id !== null
      ? String(policyStop.location_id).trim()
      : null;

  return {
    policyCode,
    policy: policyCode ? policyMap.get(policyCode) : undefined,
  };
}

function toSnapshot(order: McleodOrder) {
  const orderId = getOrderId(order);
  const pu = getStop(order, "PU");
  const so = getStop(order, "SO");
  const blnum = safeString(order.blnum);
  const { policyCode, policy } = getPolicy(order);

  return {
    office: "Savannah",
    order_id: orderId,
    revenue_code_id: safeString(order.revenue_code_id).toUpperCase(),
    customer_id: safeString(order.customer_id),
    blnum,
    mark: parseMark(blnum),
    bales: parseBales(blnum),

    movement_status: getMovementStatus(order),
    brokerage_status: getBrokerageStatus(order),
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
    const body = await req.json().catch(() => ({}));
    const orderIds = Array.isArray(body.orderIds)
      ? body.orderIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];

    if (orderIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Send JSON body like { \"orderIds\": [\"0796760\"] }",
        },
        { status: 400 }
      );
    }

    const results = [];

    for (const orderId of orderIds) {
      try {
        const order = await mcleodFetchOrder(orderId);

        if (!order) {
          results.push({ orderId, ok: false, error: "No order returned" });
          continue;
        }

        const snapshot = toSnapshot(order);

        const { error } = await supabase
          .from("late_fee_order_snapshots")
          .upsert(snapshot, {
            onConflict: "office,order_id",
          });

        if (error) {
          results.push({ orderId, ok: false, error: error.message });
          continue;
        }

        results.push({
          orderId,
          ok: true,
          revenueCode: snapshot.revenue_code_id,
          policyCode: snapshot.policy_code,
          policyType: snapshot.policy_type,
          bales: snapshot.bales,
        });
      } catch (err) {
        results.push({
          orderId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      count: results.length,
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