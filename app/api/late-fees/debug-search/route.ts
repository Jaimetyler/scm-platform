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

  if (!token) {
    throw new Error(
      "Missing MCLEOD_API_TOKEN, MCLEOD_BEARER_TOKEN, or MCLEOD_AUTH_TOKEN"
    );
  }

  return token;
}

async function probe(path: string) {
  const url = `${getBaseUrl()}${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");

  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  const count = Array.isArray(parsed)
    ? parsed.length
    : parsed && typeof parsed === "object" && "rows" in parsed
      ? Array.isArray((parsed as any).rows)
        ? (parsed as any).rows.length
        : null
      : null;

  const sample = Array.isArray(parsed)
    ? parsed.slice(0, 2).map((x: any) => ({
        id: x?.id,
        order_id: x?.order_id,
        revenue_code_id: x?.revenue_code_id,
        status: x?.status,
        blnum: x?.blnum,
        customer_id: x?.customer_id,
      }))
    : parsed && typeof parsed === "object"
      ? Object.keys(parsed as Record<string, unknown>).slice(0, 20)
      : null;

  return {
    path,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    count,
    sample,
    textPreview: text.slice(0, 500),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const revenueCode = searchParams.get("revenueCode") || "MAIN";
    const customerId = searchParams.get("customerId") || "";
    const orderId = searchParams.get("orderId") || "";
    const date = searchParams.get("date") || "20260501";

    const paths = [
      `/orders?limit=25`,
      `/orders?revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,
      `/orders?revenue_code=${encodeURIComponent(revenueCode)}&limit=25`,
      `/orders?status=A&limit=25`,
      `/orders?status=A&revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,

      `/orders/search?revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,
      `/orders/search?revenue_code=${encodeURIComponent(revenueCode)}&limit=25`,
      `/orders/search?status=A&limit=25`,
      `/orders/search?status=A&revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,

      `/orders/search?customer_id=${encodeURIComponent(customerId)}&limit=25`,
      `/orders/search?customer=${encodeURIComponent(customerId)}&limit=25`,
      `/orders/search?customer_id=${encodeURIComponent(customerId)}&revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,

      `/orders/search?id=${encodeURIComponent(orderId)}&limit=25`,
      `/orders/search?order_id=${encodeURIComponent(orderId)}&limit=25`,
      `/orders/search?blnum=${encodeURIComponent(orderId)}&limit=25`,

      `/orders/search?entered_date=${encodeURIComponent(date)}&limit=25`,
      `/orders/search?ordered_date=${encodeURIComponent(date)}&limit=25`,
      `/orders/search?entered_date_start=${encodeURIComponent(date)}&limit=25`,
      `/orders/search?ordered_date_start=${encodeURIComponent(date)}&limit=25`,

      `/orders/search?status=A&entered_date_start=${encodeURIComponent(date)}&limit=25`,
      `/orders/search?status=A&ordered_date_start=${encodeURIComponent(date)}&limit=25`,

      `/orders/tracking?status=A&limit=25`,
      `/orders/tracking?revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,
      `/orders/tracking?status=A&revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,
      `/orders/search?orders.revenue_code_id=${encodeURIComponent(revenueCode)}&limit=25`,
`/orders/search?orders.status=A&limit=25`,
`/orders/search?orders.id=${encodeURIComponent(orderId)}&limit=25`,
`/orders/search?orders.customer_id=${encodeURIComponent(customerId)}&limit=25`,
`/orders/search?orders.entered_date=${encodeURIComponent(date)}&limit=25`,

`/orders/search?movement.status=A&limit=25`,
`/orders/search?movements.status=A&limit=25`,

`/orders/search?customer.id=${encodeURIComponent(customerId)}&limit=25`,
`/orders/${encodeURIComponent(orderId)}`,
`/orders?searchValue=${encodeURIComponent(orderId)}&limit=25`,
`/orders?value=${encodeURIComponent(orderId)}&limit=25`,
`/orders?search=${encodeURIComponent(orderId)}&limit=25`,
`/orders?q=${encodeURIComponent(orderId)}&limit=25`,
`/orders?query=${encodeURIComponent(orderId)}&limit=25`,
`/orders?term=${encodeURIComponent(orderId)}&limit=25`,

`/orders?searchValue=${encodeURIComponent(customerId)}&limit=25`,
`/orders?value=${encodeURIComponent(customerId)}&limit=25`,
`/orders?search=${encodeURIComponent(customerId)}&limit=25`,
`/orders?q=${encodeURIComponent(customerId)}&limit=25`,

`/orders?searchValue=${encodeURIComponent(revenueCode)}&limit=25`,
`/orders?value=${encodeURIComponent(revenueCode)}&limit=25`,
`/orders?search=${encodeURIComponent(revenueCode)}&limit=25`,
`/orders?q=${encodeURIComponent(revenueCode)}&limit=25`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&page=1`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&page=2`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&offset=0`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&offset=100`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&skip=100`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&start=100`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&pageNumber=2`,
`/orders?q=${encodeURIComponent("COTTON")}&limit=100&pageSize=100&pageNumber=2`,
    ];

    const attempts = [];

    for (const path of paths) {
      try {
        attempts.push(await probe(path));
      } catch (err) {
        attempts.push({
          path,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      tested: {
        revenueCode,
        customerId,
        orderId,
        date,
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