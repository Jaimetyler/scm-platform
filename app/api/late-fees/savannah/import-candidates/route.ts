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

  const headers = splitCsvLine(lines[0]).map((h) =>
    h.trim().replace(/^"|"$/g, "")
  );

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, i) => {
      row[header] = values[i]?.trim().replace(/^"|"$/g, "") ?? "";
    });

    return row;
  });
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

  if (res.status === 204) return null;

  const text = await res.text();
  if (!text) return null;

  return JSON.parse(text);
}

async function hydrateOrder(orderId: string): Promise<McleodOrderSummary | null> {
  const raw = await mcleodGet(`/orders/${encodeURIComponent(orderId)}`);
  return Array.isArray(raw) ? raw[0] ?? null : (raw as McleodOrderSummary);
}

function getStop(order: McleodOrderSummary, stopType: "PU" | "SO") {
  const stops = Array.isArray(order.stops) ? order.stops : [];

  return (
    stops.find((s) => safeString(s.stop_type).toUpperCase() === stopType) ??
    null
  );
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

  const movement = Array.isArray(order.movements)
    ? order.movements[0]
    : order.movement;

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
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Upload a CSV file using form field 'file'." },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const csvRows = parseCsv(csvText);

    const orderIds = Array.from(
      new Set(
        csvRows
          .map((row) => row.order_id || row.Order || row.ORDER || row.id)
          .map((v) => safeString(v))
          .filter(Boolean)
      )
    );

    const results = [];

    for (const orderId of orderIds) {
      try {
        const order = await hydrateOrder(orderId);

        if (!order) {
          results.push({ orderId, ok: false, error: "Order not found" });
          continue;
        }

        const snapshot = buildSnapshot(order);

        if (snapshot.revenue_code_id !== "MAIN") {
          results.push({
            orderId,
            ok: false,
            skipped: true,
            reason: `wrong revenue code ${snapshot.revenue_code_id}`,
          });
          continue;
        }

        const commodityId = safeString(order.commodity_id).toUpperCase();
        const commodity = safeString(order.commodity).toUpperCase();

        if (commodityId !== "COTTON" && !commodity.includes("COTTON")) {
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

    const latestOrderIdSet = new Set(orderIds);

    const { data: existingRows, error: existingError } = await supabase
      .from("late_fee_order_snapshots")
      .select("order_id")
      .eq("office", "Savannah");

    if (existingError) {
      throw new Error(existingError.message);
    }

    const staleOrderIds = (existingRows ?? [])
      .map((r) => safeString(r.order_id))
      .filter((id) => id && !latestOrderIdSet.has(id));

    for (let i = 0; i < staleOrderIds.length; i += 100) {
      const chunk = staleOrderIds.slice(i, i + 100);

      const { error: deleteError } = await supabase
        .from("late_fee_order_snapshots")
        .delete()
        .eq("office", "Savannah")
        .in("order_id", chunk);

      if (deleteError) {
        throw new Error(deleteError.message);
      }
    }

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      csvRows: csvRows.length,
      orderIds: orderIds.length,
      saved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      staleRemoved: staleOrderIds.length,
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