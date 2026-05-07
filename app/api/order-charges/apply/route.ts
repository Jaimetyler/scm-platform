import { NextRequest, NextResponse } from "next/server";

const MCLEOD_BASE_URL = process.env.MCLEOD_BASE_URL!;
const MCLEOD_TOKEN = process.env.MCLEOD_AUTH_TOKEN!;

const MAX_APPLY_ROWS = 500;

const REQUIRED_REVENUE_CODE_BY_TERMINAL: Record<string, string> = {
  SAV: "LOCAL",
  DAL: "DLOCA",
  HOU: "HLOCA",
};

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

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundRate(amount: number, units: number) {
  if (!units) return amount;
  return Math.round((amount / units) * 10000) / 10000;
}

function normalize(value: any) {
  return String(value || "").trim().toUpperCase();
}

function extractRows(searchRes: any) {
  if (Array.isArray(searchRes)) return searchRes;
  if (Array.isArray(searchRes?.rows)) return searchRes.rows;
  if (Array.isArray(searchRes?.data)) return searchRes.data;
  if (Array.isArray(searchRes?.items)) return searchRes.items;
  return [];
}

function getOtherCharges(order: any) {
  if (Array.isArray(order?.otherCharges)) return order.otherCharges;
  if (Array.isArray(order?.other_charges)) return order.other_charges;
  if (Array.isArray(order?.otherCharge)) return order.otherCharge;
  return [];
}

function sameCharge(existing: any, incoming: any) {
  return (
    normalize(existing.charge_id || existing.chargeId) ===
      normalize(incoming.charge_id || incoming.chargeId) &&
    Number(existing.units || 0) === Number(incoming.units || 0) &&
    roundMoney(Number(existing.amount || 0)) ===
      roundMoney(Number(incoming.amount || 0))
  );
}

async function findOrderByBlnumAndTerminal(blnum: string, terminal: string) {
  const terminalKey = normalize(terminal);
  const requiredRevenueCode = REQUIRED_REVENUE_CODE_BY_TERMINAL[terminalKey];

  if (!requiredRevenueCode) {
    throw new Error(`Unsupported terminal: ${terminal}`);
  }

  const searchRes = await mcleodRequest(
    `/orders/search?blnum=${encodeURIComponent(blnum)}`
  );

  const rows = extractRows(searchRes);

  if (rows.length === 0) {
    return null;
  }

  const candidates: any[] = [];
  const found: string[] = [];

  for (const row of rows) {
    const orderId = row?.id;
    if (!orderId) continue;

    const order = await mcleodRequest(`/orders/${orderId}`);
    const revenueCode = normalize(order?.revenue_code_id);

    found.push(`${orderId}: revenue=${revenueCode || "blank"}`);

    if (revenueCode === requiredRevenueCode) {
      candidates.push(order);
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `Order(s) found for blnum ${blnum}, but none match terminal ${terminalKey}. Required revenue code: ${requiredRevenueCode}. Found: ${found.join(
        ", "
      )}`
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      `Multiple ${terminalKey} orders found for blnum ${blnum} with revenue code ${requiredRevenueCode}. Refusing to apply charges automatically. Matches: ${candidates
        .map((o) => `${o.id}:${o.revenue_code_id || "blank"}`)
        .join(", ")}`
    );
  }

  return candidates[0];
}

async function autorateOrder(orderId: string) {
  return mcleodRequest(`/orders/autorate/${orderId}`, "POST");
}

export async function POST(req: NextRequest) {
  try {
    const syncEnabled = process.env.MCLEOD_SYNC_ENABLED === "true";

    if (!syncEnabled) {
      return NextResponse.json(
        {
          ok: false,
          error: "Apply blocked: MCLEOD_SYNC_ENABLED is not true",
          syncEnabled: process.env.MCLEOD_SYNC_ENABLED,
        },
        { status: 400 }
      );
    }

    const { preview, terminal } = await req.json();

    const terminalKey = normalize(terminal);
    const requiredRevenueCode = REQUIRED_REVENUE_CODE_BY_TERMINAL[terminalKey];

    if (!terminalKey) {
      return NextResponse.json(
        { ok: false, error: "Missing terminal" },
        { status: 400 }
      );
    }

    if (!requiredRevenueCode) {
      return NextResponse.json(
        { ok: false, error: `Unsupported terminal: ${terminal}` },
        { status: 400 }
      );
    }

    if (!Array.isArray(preview) || preview.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing preview rows" },
        { status: 400 }
      );
    }

    if (preview.length > MAX_APPLY_ROWS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Too many rows selected. You tried to apply ${preview.length} rows. Limit is ${MAX_APPLY_ROWS} at a time.`,
          row_count: preview.length,
          max_apply_rows: MAX_APPLY_ROWS,
        },
        { status: 400 }
      );
    }

    let success = 0;
    let failed = 0;
    let skippedDuplicates = 0;
    let totalChargesAttempted = 0;
    let totalChargesVerified = 0;

    const results: any[] = [];

    for (const item of preview) {
      const { blnum, charges } = item;

      try {
        if (!blnum) throw new Error("Missing blnum");

        if (!Array.isArray(charges) || charges.length === 0) {
          throw new Error(`No charges supplied for blnum ${blnum}`);
        }

        const order = await findOrderByBlnumAndTerminal(
          String(blnum),
          terminalKey
        );

        if (!order?.id) {
          throw new Error(
            `Order not found for blnum ${blnum} and terminal ${terminalKey}`
          );
        }

        const orderId = order.id;
        const existingCharges = getOtherCharges(order);

        const incomingCharges = charges.map((c: any) => {
          const units = Number(c.units || 1);
          const amount = roundMoney(Number(c.amount || 0));
          const rate = roundRate(amount, units);

          return {
            __type: "other_charge",
            __name: "otherCharges",
            company_id: order.company_id || "TMS",
            charge_id: c.charge_id,
            descr: String(c.description || c.charge_id).slice(0, 28),
            units,
            rate,
            amount,
            incl_in_freight: "N",
            bill_type: "F",
            calc_method: "F",
          };
        });

        const newCharges = incomingCharges.filter(
          (incoming: any) =>
            !existingCharges.some((existing: any) =>
              sameCharge(existing, incoming)
            )
        );

        const duplicateCount = incomingCharges.length - newCharges.length;
        skippedDuplicates += duplicateCount;

        if (newCharges.length === 0) {
          results.push({
            blnum,
            status: "skipped",
            orderId,
            terminal: terminalKey,
            required_revenue_code: requiredRevenueCode,
            revenue_code_id: order.revenue_code_id,
            reason: "All charges already exist",
            charges_before: existingCharges.length,
            charges_attempted: 0,
            charges_after: existingCharges.length,
            charges_verified_added: 0,
            duplicates_skipped: duplicateCount,
          });

          success++;
          continue;
        }

        order.otherCharges = [...existingCharges, ...newCharges];

        console.log("ABOUT TO CALL MCLEOD APPLY", {
          orderId,
          terminal: terminalKey,
          required_revenue_code: requiredRevenueCode,
          revenue_code_id: order.revenue_code_id,
          charges_before: existingCharges.length,
          charges_to_add: newCharges.length,
        });

        const updateResult = await mcleodRequest("/orders/update", "PUT", order);

        console.log("MCLEOD UPDATE RESULT", {
          orderId,
          ok: true,
          responseType: updateResult?.__type || typeof updateResult,
        });

        let autorateError: string | null = null;

        try {
          await autorateOrder(orderId);
        } catch (err: any) {
          autorateError = err.message;
        }

        const verify = await mcleodRequest(`/orders/${orderId}`);
        const verifiedCharges = getOtherCharges(verify);

        const verifiedAddedCount = newCharges.filter((incoming: any) =>
          verifiedCharges.some((existing: any) => sameCharge(existing, incoming))
        ).length;

        const appliedConfirmed = verifiedAddedCount === newCharges.length;

        totalChargesAttempted += newCharges.length;
        totalChargesVerified += verifiedAddedCount;

        results.push({
          blnum,
          status: appliedConfirmed ? "updated" : "update_not_verified",
          orderId,
          terminal: terminalKey,
          required_revenue_code: requiredRevenueCode,
          revenue_code_id: order.revenue_code_id,
          charges_before: existingCharges.length,
          charges_attempted: newCharges.length,
          charges_after: verifiedCharges.length,
          charges_verified_added: verifiedAddedCount,
          duplicates_skipped: duplicateCount,
          autorate_ok: !autorateError,
          autorate_error: autorateError,
        });

        if (appliedConfirmed) {
          success++;
        } else {
          failed++;
        }
      } catch (err: any) {
        console.error("APPLY ITEM FAILED", {
          blnum,
          terminal: terminalKey,
          error: err.message,
        });

        results.push({
          blnum,
          status: "failed",
          error: err.message,
        });

        failed++;
      }
    }

    const ok = failed === 0;

    return NextResponse.json({
      ok,
      message: ok
        ? `Successfully applied charges to ${success} order(s).`
        : `Apply completed with ${failed} failed row(s).`,
      terminal: terminalKey,
      required_revenue_code: requiredRevenueCode,
      success,
      failed,
      skipped_duplicates: skippedDuplicates,
      total_charges_attempted: totalChargesAttempted,
      total_charges_verified: totalChargesVerified,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
      },
      { status: 500 }
    );
  }
}