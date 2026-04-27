import { NextResponse } from "next/server";

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

async function fetchMcleod(path: string) {
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

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    textPreview: text.slice(0, 500),
    parsed,
  };
}

function summarizeParsed(parsed: unknown) {
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    return {
      type: "array",
      count: parsed.length,
      firstKeys:
        first && typeof first === "object" && !Array.isArray(first)
          ? Object.keys(first as Record<string, unknown>).slice(0, 20)
          : [],
      firstItem: first ?? null,
    };
  }

  if (parsed && typeof parsed === "object") {
    return {
      type: "object",
      keys: Object.keys(parsed as Record<string, unknown>).slice(0, 30),
      sample: parsed,
    };
  }

  return {
    type: parsed === null ? "null" : typeof parsed,
    value: parsed,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId") || "0773278";

    const attempts = [
      { name: "orders limit 25", path: `/orders?limit=25` },
      { name: "direct order by id", path: `/orders/${encodeURIComponent(orderId)}` },

      // These may fail depending on your permissions / endpoint behavior.
      { name: "tracking status A", path: `/orders/tracking?status=A&limit=25` },
      { name: "tracking status P", path: `/orders/tracking?status=P&limit=25` },

      // McLeod search can be picky, but let's probe a few forms.
      {
        name: 'search filter revenue_code_id eq "DAVIS"',
        path: `/orders/search?filter=${encodeURIComponent('revenue_code_id eq "DAVIS"')}&limit=25`,
      },
      {
        name: 'search filters revenue_code_id eq "DAVIS"',
        path: `/orders/search?filters=${encodeURIComponent('revenue_code_id eq "DAVIS"')}&limit=25`,
      },
      {
        name: 'search order_id eq provided id',
        path: `/orders/search?filter=${encodeURIComponent(`order_id eq "${orderId}"`)}&limit=25`,
      },
      {
        name: "search q/order fallback by id",
        path: `/orders/search?q=${encodeURIComponent(orderId)}&limit=25`,
      },
      {
  name: "search entered_date test",
  path: `/orders/search?filter=${encodeURIComponent('entered_date gt "2026-03-01"')}&limit=25`,
}
    ];

    const results = [];

    for (const attempt of attempts) {
      try {
        const res = await fetchMcleod(attempt.path);
        results.push({
          name: attempt.name,
          path: attempt.path,
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          summary: summarizeParsed(res.parsed),
          textPreview: res.textPreview,
        });
      } catch (error) {
        results.push({
          name: attempt.name,
          path: attempt.path,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      baseUrl: getBaseUrl(),
      testedOrderId: orderId,
      attempts: results,
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