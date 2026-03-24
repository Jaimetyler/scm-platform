import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getBaseUrl() {
  const baseUrl = process.env.MCLEOD_BASE_URL;
  if (!baseUrl) {
    throw new Error("Missing MCLEOD_BASE_URL");
  }
  return baseUrl.replace(/\/+$/, "");
}

function getHeaders() {
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!token) {
    throw new Error("Missing MCLEOD_AUTH_TOKEN");
  }

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

async function fetchJsonOrText(url: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  let parsed: unknown = text;
  if (contentType.includes("application/json") && text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    url,
    contentType,
    data: parsed,
    rawPreview: text.slice(0, 4000),
  };
}

export async function GET() {
  try {
    const baseUrl = getBaseUrl();

    const tests = await Promise.all([
      fetchJsonOrText(`${baseUrl}/orders?q=598`),
      fetchJsonOrText(
        `${baseUrl}/orders/search?orders.customer_id=BUNGOMNE&orders.status=P&recordLength=5`
      ),
      fetchJsonOrText(`${baseUrl}/orders/12345678`),
      fetchJsonOrText(`${baseUrl}/orders/tracking?blnum=598&status=P`),
    ]);

    return NextResponse.json({
      ok: true,
      tests: {
        ordersQ: tests[0],
        ordersSearch: tests[1],
        orderById: tests[2],
        ordersTracking: tests[3],
      },
    });
  } catch (error: any) {
    console.error("MCLEOD TEST ERROR:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unknown error",
        stack: error?.stack || null,
      },
      { status: 500 }
    );
  }
}