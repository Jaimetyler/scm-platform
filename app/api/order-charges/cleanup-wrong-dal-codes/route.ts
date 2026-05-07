import { NextRequest, NextResponse } from "next/server";

const MCLEOD_BASE_URL = process.env.MCLEOD_BASE_URL!;
const MCLEOD_TOKEN = process.env.MCLEOD_AUTH_TOKEN!;

const BAD_DAL_CHARGE_IDS = new Set([
  "DCRS",
  "DCS",
  "DC36",
  "DCBT",
  "DC23",
  "DC64",
  "DC65",
]);

const TARGET_REVENUE_CODES = new Set(["LOCAL"]);
const BAD_RUN_DATE_PREFIX = "20260429";

async function mcleodRequest(path: string, method = "GET", payload?: any) {
  const res = await fetch(`${MCLEOD_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${MCLEOD_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
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

function norm(v: any) {
  return String(v || "").trim().toUpperCase();
}

function extractRows(res: any) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.rows)) return res.rows;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.items)) return res.items;
  return [];
}

function isBadCharge(c: any) {
  const amountDate = String(c.amount_d || "");

  return (
    BAD_DAL_CHARGE_IDS.has(norm(c.charge_id)) &&
    (amountDate.includes("20260429") || amountDate.includes("04/29/2026"))
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const dryRun = body.dryRun !== false;

    const blnums: string[] = Array.isArray(body.blnums)
      ? body.blnums.map(String).filter(Boolean)
      : [];

    if (blnums.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Send blnums array. dryRun defaults to true." },
        { status: 400 }
      );
    }

    const results: any[] = [];

    for (const blnum of blnums) {
      try {
        const search = await mcleodRequest(
          `/orders/search?blnum=${encodeURIComponent(blnum)}`
        );

        const rows = extractRows(search);

        if (rows.length === 0) {
          results.push({ blnum, status: "not_found" });
          continue;
        }

        for (const row of rows) {
          const orderId = row?.id;
          if (!orderId) continue;

          const order = await mcleodRequest(`/orders/${orderId}`);
          const revenueCode = norm(order.revenue_code_id);

          const otherCharges = Array.isArray(order.otherCharges)
            ? order.otherCharges
            : [];

          const badCharges = otherCharges.filter(isBadCharge);

          if (!TARGET_REVENUE_CODES.has(revenueCode)) {
            results.push({
              blnum,
              orderId,
              status: "blocked",
              reason: `Revenue code ${revenueCode} is not target cleanup revenue code`,
              revenue_code_id: revenueCode,
              bad_charge_count: badCharges.length,
            });
            continue;
          }

          if (badCharges.length === 0) {
            results.push({
              blnum,
              orderId,
              status: "clean",
              revenue_code_id: revenueCode,
              removed_count: 0,
            });
            continue;
          }

          for (const c of order.otherCharges) {
            if (isBadCharge(c)) {
              c.__deleted = true;
              c.__status = "D";
            }
          }

          if (!dryRun) {
            await mcleodRequest("/orders/updateRow", "PUT", order);
          }

          results.push({
            blnum,
            orderId,
            status: dryRun ? "dry_run_would_delete" : "deleted",
            revenue_code_id: revenueCode,
            removed_count: badCharges.length,
            removed: badCharges.map((c: any) => ({
              id: c.id,
              sequence: c.sequence,
              charge_id: c.charge_id,
              descr: c.descr,
              units: c.units,
              rate: c.rate,
              amount: c.amount,
              amount_d: c.amount_d,
            })),
          });
        }
      } catch (err: any) {
        results.push({
          blnum,
          status: "failed",
          error: err.message,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      target_revenue_codes: Array.from(TARGET_REVENUE_CODES),
      bad_run_date_prefix: BAD_RUN_DATE_PREFIX,
      bad_charge_ids: Array.from(BAD_DAL_CHARGE_IDS),
      count: results.length,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}