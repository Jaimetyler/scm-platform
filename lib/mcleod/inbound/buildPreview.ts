import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";

type CustomerResolution = {
  canonicalCustomer: string;
  customerId: string;
  customerName: string;
};

type SearchCandidate = {
  orderId: string;
  movementId: string;
  customerId: string;
  blnum?: string | null;
  consigneeRefNo?: string | null;
  movementStatus?: string | null;
};

type ParsedBlnum = {
  raw: string | null;
  mark: string | null;
  count: string | null;
  unit: string | null;
};

export type PreviewResult = {
  row: InboundExcelRow;
  resolvedCustomer: CustomerResolution;
  candidateCount: number;
  status: "Matched" | "Possible Match" | "No Match";
  matchedOrderId: string | null;
  reason: string;
  parsedBlnum: ParsedBlnum | null;
  proposed: {
    orderId: string;
    movementId: string;
    customerId: string;
    blnum: string | null;
    consigneeRefNo: string | null;
    movementStatus: string | null;
  } | null;
};

const BUILD_PREVIEW_VERSION = "2026-03-24-search-queryparams-v3";

function getBaseUrl() {
  const baseUrl = process.env.MCLEOD_BASE_URL;
  if (!baseUrl) throw new Error("Missing MCLEOD_BASE_URL");
  return baseUrl.replace(/\/+$/, "");
}

function getHeaders(): HeadersInit {
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!token) throw new Error("Missing MCLEOD_AUTH_TOKEN");

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function normalizeValue(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeMark(value: unknown): string {
  return normalizeValue(value).replace(/[^A-Z0-9]/g, "");
}

function parseCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function resolveCustomer(shipper: string): CustomerResolution {
  const normalized = normalizeValue(shipper);

  if (normalized === "BUNGE") {
    return {
      canonicalCustomer: "BUNGE",
      customerId: "BUNGOMNE",
      customerName: "Bunge USA Agriculture, LLC.",
    };
  }

  if (normalized === "OLAM" || normalized === "OLAM COTTON") {
    return {
      canonicalCustomer: "Olam Cotton",
      customerId: "OLAMRITX",
      customerName: "Olam Cotton",
    };
  }

  if (normalized === "LDC") {
    return {
      canonicalCustomer: "LDC",
      customerId: "ALLECOTN",
      customerName: "Allenberg Cotton Co.",
    };
  }

  if (normalized === "COFCO") {
    return {
      canonicalCustomer: "COFCO",
      customerId: "NOBLHOTX",
      customerName: "COFCO",
    };
  }

  if (
    normalized === "STAPL" ||
    normalized === "STAPLCOTN" ||
    normalized === "STAPLCOTN CO OP ASSN"
  ) {
    return {
      canonicalCustomer: "StaplCotn",
      customerId: "STAPGRMS",
      customerName: "STAPLCOTN CO OP ASSN",
    };
  }

  return {
    canonicalCustomer: normalized,
    customerId: normalized,
    customerName: normalized,
  };
}

function parseBlnum(raw: unknown): ParsedBlnum | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const match = text.match(/^(.+?)\s+(\d+)\s+([A-Z]+)$/i);
  if (!match) {
    return {
      raw: text,
      mark: null,
      count: null,
      unit: null,
    };
  }

  return {
    raw: text,
    mark: normalizeMark(match[1]),
    count: match[2] ?? null,
    unit: (match[3] ?? "").toUpperCase() || null,
  };
}

function wildcard(value: string) {
  return `*${value}*`;
}

async function searchOrders(customerId: string, mark: string): Promise<SearchCandidate[]> {
  const baseUrl = getBaseUrl();

  async function runSearch(orderField: "orders.consignee_refno" | "orders.blnum") {
    const qs = new URLSearchParams({
      "customer.id": customerId,
      [orderField]: wildcard(mark),
      recordLength: "200",
    });

    const url = `${baseUrl}/orders/search?${qs.toString()}`;

    console.log("BUILD_PREVIEW_VERSION", BUILD_PREVIEW_VERSION);
    console.log("MCLEOD_SEARCH_FIELD", orderField);
    console.log("MCLEOD_SEARCH_URL", url);

    const res = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
      cache: "no-store",
    });

    const text = await res.text();

    console.log("MCLEOD_SEARCH_STATUS", res.status);
    console.log("MCLEOD_SEARCH_BODY", text);

    if (!res.ok) {
      throw new Error(`McLeod search failed ${res.status} ${text}`);
    }

    const parsed = text ? JSON.parse(text) : [];

    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.items)
      ? (parsed as any).items
      : Array.isArray((parsed as any)?.results)
      ? (parsed as any).results
      : [];

    return rows.map((item: any) => ({
      orderId: String(item.id ?? item.orderId ?? ""),
      movementId: String(
        item.curr_movement_id ??
          item.currMovementId ??
          item.movementId ??
          item.movements?.[0]?.id ??
          ""
      ),
      customerId: String(item.customer_id ?? item.customerId ?? customerId),
      blnum: item.blnum ?? null,
      consigneeRefNo: item.consignee_refno ?? item.consigneeRefNo ?? null,
      movementStatus:
        item.movement_status ??
        item.movementStatus ??
        item.movements?.[0]?.status ??
        item.status ??
        null,
    })) as SearchCandidate[];
  }

  const [byRef, byBlnum] = await Promise.all([
    runSearch("orders.consignee_refno"),
    runSearch("orders.blnum"),
  ]);

  const deduped = new Map<string, SearchCandidate>();

  for (const candidate of [...byRef, ...byBlnum]) {
    if (candidate.orderId) {
      deduped.set(candidate.orderId, candidate);
    }
  }

  return Array.from(deduped.values());
}

function buildProposed(candidate: SearchCandidate | null) {
  if (!candidate) return null;

  return {
    orderId: candidate.orderId,
    movementId: candidate.movementId,
    customerId: candidate.customerId,
    blnum: candidate.blnum ?? null,
    consigneeRefNo: candidate.consigneeRefNo ?? null,
    movementStatus: candidate.movementStatus ?? null,
  };
}

export async function buildPreview(rows: InboundExcelRow[]): Promise<PreviewResult[]> {
  console.log("BUILD_PREVIEW_LOADED", BUILD_PREVIEW_VERSION);

  const results: PreviewResult[] = [];

  for (const row of rows) {
    const resolvedCustomer = resolveCustomer(row.shipper);
    const targetMark = normalizeMark(row.mark);
    const targetBales = parseCount(row.balesUnloaded) ?? parseCount(row.bolBC);

    console.log("BUILD_PREVIEW_ROW", {
      receivedDate: row.receivedDate,
      mark: row.mark,
      shipper: row.shipper,
      resolvedCustomer,
      targetMark,
      targetBales,
    });

    if (!targetMark) {
      results.push({
        row,
        resolvedCustomer,
        candidateCount: 0,
        status: "No Match",
        matchedOrderId: null,
        reason: "Missing mark",
        parsedBlnum: null,
        proposed: null,
      });
      continue;
    }

    const rawCandidates = await searchOrders(resolvedCustomer.customerId, targetMark);

    const enriched = rawCandidates.map((candidate) => {
      const parsed = parseBlnum(candidate.blnum);
      const parsedMark = normalizeMark(parsed?.mark ?? "");
      const parsedCount = parseCount(parsed?.count);
      const refMark = normalizeMark(candidate.consigneeRefNo);

      const exactMark = parsedMark === targetMark || refMark === targetMark;

      const baleMatch =
        targetBales !== null && parsedCount !== null
          ? targetBales === parsedCount
          : null;

      return {
        ...candidate,
        parsedBlnum: parsed,
        exactMark,
        baleMatch,
      };
    });

    const exactMarkCandidates = enriched.filter((c) => c.exactMark);

    if (exactMarkCandidates.length === 0) {
      results.push({
        row,
        resolvedCustomer,
        candidateCount: rawCandidates.length,
        status: "No Match",
        matchedOrderId: null,
        reason: `No McLeod candidates found for customer ${resolvedCustomer.customerId} and mark ${targetMark}`,
        parsedBlnum: null,
        proposed: null,
      });
      continue;
    }

    const exactMarkAndBale = exactMarkCandidates.filter((c) => c.baleMatch === true);

    if (exactMarkAndBale.length === 1) {
      const winner = exactMarkAndBale[0];

      results.push({
        row,
        resolvedCustomer,
        candidateCount: exactMarkCandidates.length,
        status: "Matched",
        matchedOrderId: winner.orderId,
        reason: "Strong match on exact mark and bale count",
        parsedBlnum: winner.parsedBlnum,
        proposed: buildProposed(winner),
      });
      continue;
    }

    if (exactMarkCandidates.length === 1) {
      const winner = exactMarkCandidates[0];

      results.push({
        row,
        resolvedCustomer,
        candidateCount: exactMarkCandidates.length,
        status: "Matched",
        matchedOrderId: winner.orderId,
        reason:
          targetBales === null
            ? "Matched on exact mark; bale count missing from row"
            : "Matched on exact mark; bale count not used as tie-breaker",
        parsedBlnum: winner.parsedBlnum,
        proposed: buildProposed(winner),
      });
      continue;
    }

    const first = exactMarkAndBale[0] ?? exactMarkCandidates[0] ?? null;

    results.push({
      row,
      resolvedCustomer,
      candidateCount: exactMarkCandidates.length,
      status: "Possible Match",
      matchedOrderId: first?.orderId ?? null,
      reason: "Multiple exact-mark candidates found",
      parsedBlnum: first?.parsedBlnum ?? null,
      proposed: buildProposed(first),
    });
  }

  return results;
}