import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function probe(name: string, body: unknown) {
  const res = await fetch(`${getBaseUrl()}/orders/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}

  return {
    name,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    body,
    type: Array.isArray(parsed) ? "array" : typeof parsed,
    count: Array.isArray(parsed) ? parsed.length : null,
    sample: Array.isArray(parsed)
      ? parsed.slice(0, 2).map((x) => ({
          id: x?.id,
          revenue_code_id: x?.revenue_code_id,
          status: x?.status,
          blnum: x?.blnum,
          customer_id: x?.customer_id,
        }))
      : parsed && typeof parsed === "object"
        ? Object.keys(parsed).slice(0, 25)
        : null,
    textPreview: text.slice(0, 700),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const revenueCode = searchParams.get("revenueCode") || "MAIN";
    const customerId = searchParams.get("customerId") || "EDFMHOTX";
    const orderId = searchParams.get("orderId") || "0796869";

    const bodies = [
      {
        name: "flat revenue",
        body: { revenue_code_id: revenueCode },
      },
      {
        name: "flat revenue status",
        body: { revenue_code_id: revenueCode, status: "A" },
      },
      {
        name: "flat customer",
        body: { customer_id: customerId },
      },
      {
        name: "flat id",
        body: { id: orderId },
      },
      {
        name: "orders object",
        body: { orders: { revenue_code_id: revenueCode } },
      },
      {
        name: "order object",
        body: { order: { revenue_code_id: revenueCode } },
      },
      {
        name: "search object",
        body: { search: { revenue_code_id: revenueCode } },
      },
      {
        name: "criteria object",
        body: { criteria: { revenue_code_id: revenueCode } },
      },
      {
        name: "filters array",
        body: {
          filters: [
            {
              field: "revenue_code_id",
              operator: "eq",
              value: revenueCode,
            },
          ],
        },
      },
      {
        name: "where array",
        body: {
          where: [
            {
              field: "revenue_code_id",
              op: "eq",
              value: revenueCode,
            },
          ],
        },
      },
    ];

    const attempts = [];

    for (const item of bodies) {
      try {
        attempts.push(await probe(item.name, item.body));
      } catch (error) {
        attempts.push({
          name: item.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          body: item.body,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      tested: {
        revenueCode,
        customerId,
        orderId,
      },
      attempts,
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