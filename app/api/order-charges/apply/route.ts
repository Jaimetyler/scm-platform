import { NextRequest, NextResponse } from "next/server";

const MCLEOD_BASE_URL = process.env.MCLEOD_BASE_URL!;
const MCLEOD_TOKEN = process.env.MCLEOD_AUTH_TOKEN!;

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

function sameCharge(existing: any, incoming: any) {
  return (
    String(existing.charge_id || "").trim() === String(incoming.charge_id || "").trim() &&
    Number(existing.units || 0) === Number(incoming.units || 0) &&
    roundMoney(Number(existing.amount || 0)) === roundMoney(Number(incoming.amount || 0))
  );
}

async function findOrderByBlnum(blnum: string) {
  const searchRes = await mcleodRequest(
    `/orders/search?blnum=${encodeURIComponent(blnum)}`
  );

  const rows = Array.isArray(searchRes) ? searchRes : searchRes?.rows || [];
  return rows?.[0]?.id || null;
}

async function autorateOrder(orderId: string) {
  return mcleodRequest(`/orders/autorate/${orderId}`, "POST");
}

export async function POST(req: NextRequest) {
  try {
    const { preview } = await req.json();

    if (!Array.isArray(preview) || preview.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing preview rows" },
        { status: 400 }
      );
    }

    let success = 0;
    let failed = 0;
    let skippedDuplicates = 0;
    const results: any[] = [];

    for (const item of preview) {
      const { blnum, charges } = item;

      try {
        if (!blnum) throw new Error("Missing blnum");
        if (!Array.isArray(charges) || charges.length === 0) {
          throw new Error(`No charges supplied for blnum ${blnum}`);
        }

        const orderId = await findOrderByBlnum(String(blnum));

        if (!orderId) {
          throw new Error(`Order not found for blnum ${blnum}`);
        }

        const order = await mcleodRequest(`/orders/${orderId}`);
        const existingCharges = order.otherCharges || [];

        const incomingCharges = charges.map((c: any) => {
          const units = Number(c.units || 1);
          const amount = roundMoney(Number(c.amount || 0));
          const rate = roundRate(amount, units);

          return {
            __type: "other_charge",
            __name: "otherCharges",
            company_id: "TMS",
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
            !existingCharges.some((existing: any) => sameCharge(existing, incoming))
        );

        const duplicateCount = incomingCharges.length - newCharges.length;
        skippedDuplicates += duplicateCount;

        if (newCharges.length === 0) {
          results.push({
            blnum,
            status: "skipped",
            orderId,
            reason: "All charges already exist",
            duplicates_skipped: duplicateCount,
          });
          success++;
          continue;
        }

        order.otherCharges = [...existingCharges, ...newCharges];

        await mcleodRequest("/orders/update", "PUT", order);
        await autorateOrder(orderId);

        results.push({
          blnum,
          status: "updated",
          orderId,
          charges_added: newCharges.length,
          duplicates_skipped: duplicateCount,
        });

        success++;
      } catch (err: any) {
        results.push({
          blnum,
          status: "failed",
          error: err.message,
        });

        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      success,
      failed,
      skipped_duplicates: skippedDuplicates,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}