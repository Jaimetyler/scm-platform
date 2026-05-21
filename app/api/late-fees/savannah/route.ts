import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { officeConfigs } from "@/lib/late-fees/officeConfigs";
import {
  buildKeepDebug,
  mapOrderToLateFeeRow,
  shouldKeepOrder,
} from "@/lib/late-fees/engine";
import type { McleodOrderSummary } from "@/lib/late-fees/types";
import { getOrderId } from "@/lib/late-fees/orderHelpers";
import { safeString } from "@/lib/late-fees/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 500;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCandidateOrdersFromSnapshots(
  limit: number
): Promise<McleodOrderSummary[]> {
  const config = officeConfigs.savannah;

  const { data, error } = await supabase
    .from("late_fee_order_snapshots")
    .select("raw_order")
    .eq("office", config.office)
    .in("revenue_code_id", config.revenueCodes)
    .order("synced_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => row.raw_order)
    .filter(Boolean) as McleodOrderSummary[];
}

export async function GET(req: Request) {
  try {
    const config = officeConfigs.savannah;
    const { searchParams } = new URL(req.url);

    const limit =
      Number.parseInt(searchParams.get("limit") ?? "", 10) || DEFAULT_LIMIT;
    const includeZeroLate = searchParams.get("includeZeroLate") === "1";
    const includeNoPolicy = searchParams.get("includeNoPolicy") === "1";
    const debug = searchParams.get("debug") === "1";

    const baseOrders = await getCandidateOrdersFromSnapshots(limit);

    const matchingRevenue = baseOrders.filter((order) => {
      const revenueCode = safeString(order.revenue_code_id).toUpperCase();
      return config.revenueCodes.includes(revenueCode);
    });

    const filtered = matchingRevenue.filter((order) =>
      shouldKeepOrder(order, config)
    );

    const mappedRows = filtered.map((order) =>
      mapOrderToLateFeeRow(order, config)
    );

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
        acc.totalLateFees += row.lateFee;
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
      totals.orders > 0
        ? Math.round((totals.totalEffectiveDaysLate / totals.orders) * 100) / 100
        : 0;

    const policyMatchedCount = mappedRows.filter((x) => x.hasPolicy).length;
    const policyMissingCount = mappedRows.length - policyMatchedCount;

    return NextResponse.json({
      ok: true,
      office: config.office,
      source: "supabase_snapshots",
      matchingKey: `${config.policyMatch}.location_id => policy.mcleod_code`,
      assumptions: {
        revenueCodes: config.revenueCodes,
        excludedMovementStatuses: config.excludedMovementStatuses,
        excludedBrokerageStatuses: config.excludedBrokerageStatuses,
        policyMatching: `Policies are matched by ${config.policyMatch}.location_id.`,
        graceRule: config.graceRule,
        notes: [
          "This route calculates current late fee exposure for Savannah.",
          "Default source is Supabase late_fee_order_snapshots.",
          "Savannah uses the shared late-fee engine.",
          "Rows without matching policies are excluded by default.",
          "Rows with zero effective days late are excluded by default.",
        ],
      },
      totals: {
        ...totals,
        totalLateFees: Math.round(totals.totalLateFees * 100) / 100,
        avgEffectiveDaysLate,
      },
      count: rows.length,
      rows,
      ...(debug
        ? {
            debug: {
              mode: "snapshot_source",
              fetchedOrderSummaries: baseOrders.length,
              matchingRevenueSummaries: matchingRevenue.length,
              keptOrders: filtered.length,
              mappedRowsBeforeFinalFilters: mappedRows.length,
              policyMatchedCount,
              policyMissingCount,
              includedRows: rows.length,
              orderIds: rows.map((r) => getOrderId({ id: r.orderId })),
              keepDebug: buildKeepDebug(matchingRevenue, config),
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