import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";
import { CUSTOMER_XREF } from "@/lib/mcleod/inbound/xref";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";

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

const BUILD_PREVIEW_VERSION = "2026-03-25-customer-batch-fallback-v7";

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

function normalizeCustomerKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function parseCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function resolveCustomer(shipper: string): CustomerResolution {
  const normalizedInput = normalizeCustomerKey(shipper);

  const match = CUSTOMER_XREF.find(
    (row) => row.active && normalizeCustomerKey(row.alias) === normalizedInput
  );

  if (match) {
    return {
      canonicalCustomer: match.canonicalCustomer,
      customerId: match.customerId,
      customerName: match.customerName,
    };
  }

  return {
    canonicalCustomer: normalizeValue(shipper),
    customerId: normalizeValue(shipper),
    customerName: normalizeValue(shipper),
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

function fuzzyWildcard(value: string) {
  return `*${value.split("").join("*")}*`;
}

function splitAlphaNumericMark(value: string): { letters: string; digits: string } | null {
  const match = value.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;

  return {
    letters: match[1] ?? "",
    digits: match[2] ?? "",
  };
}

function buildSearchPatterns(mark: string): string[] {
  const patterns = new Set<string>();

  patterns.add(wildcard(mark));
  patterns.add(fuzzyWildcard(mark));

  const split = splitAlphaNumericMark(mark);

  if (split) {
    const { letters, digits } = split;

    patterns.add(wildcard(`${letters}-${digits}`));
    patterns.add(wildcard(`${letters} ${digits}`));

    if (digits.length < 3) {
      const padded = digits.padStart(3, "0");
      patterns.add(wildcard(`${letters}${padded}`));
      patterns.add(wildcard(`${letters}-${padded}`));
      patterns.add(wildcard(`${letters} ${padded}`));
    }
  }

  return Array.from(patterns);
}

function parseSearchRows(parsed: unknown): SearchCandidate[] {
  const rows = extractSearchOrders(parsed) ?? [];

  return rows.map((item: any) => ({
    orderId: String(item.id ?? item.orderId ?? ""),
    movementId: String(
      item.curr_movement_id ??
        item.currMovementId ??
        item.movementId ??
        item.movements?.[0]?.id ??
        ""
    ),
    customerId: String(item.customer_id ?? item.customerId ?? ""),
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

type SearchContext = { strict: boolean; incomplete: Set<string> };

function unexpectedSearchShape(parsed: unknown): string {
  if (parsed === null) return "empty response body";
  if (typeof parsed !== "object") return `unexpected ${typeof parsed} response`;
  return `unexpected response fields: ${Object.keys(parsed).slice(0, 8).join(", ") || "none"}`;
}

async function searchOrders(customerId: string, mark: string, context: SearchContext): Promise<SearchCandidate[]> {
  const baseUrl = getBaseUrl();

  async function runSearch(
    orderField: "orders.consignee_refno" | "orders.blnum"
  ): Promise<SearchCandidate[]> {
    const patterns = buildSearchPatterns(mark);
    const results: SearchCandidate[] = [];

    for (const pattern of patterns) {
      const params: Record<string, string> = {
        [orderField]: pattern,
        recordLength: "200",
      };

      if (customerId && customerId.trim() !== "") {
        params["customer.id"] = customerId;
      }

      const qs = new URLSearchParams(params);
      const url = `${baseUrl}/orders/search?${qs.toString()}`;

      console.log("BUILD_PREVIEW_VERSION", BUILD_PREVIEW_VERSION);
      console.log("MCLEOD_SEARCH_FIELD", orderField);
      console.log("MCLEOD_SEARCH_PATTERN", pattern);
      console.log("MCLEOD_SEARCH_URL", url);

      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: getHeaders(),
          cache: "no-store",
        });
      } catch (error) {
        if (!context.strict) throw error;
        context.incomplete.add("network error");
        continue;
      }

      const text = await res.text();

      console.log("MCLEOD_SEARCH_STATUS", res.status);
      console.log("MCLEOD_SEARCH_BODY", text);

      if (!res.ok) {
        if (context.strict) context.incomplete.add(`HTTP ${res.status}`);
        console.warn("MCLEOD_SEARCH_ERROR", res.status, text);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (error) {
        if (!context.strict) throw error;
        context.incomplete.add("invalid JSON");
        continue;
      }
      if (context.strict && !extractSearchOrders(parsed)) {
        context.incomplete.add(unexpectedSearchShape(parsed));
        continue;
      }
      const found = parseSearchRows(parsed);
      if (context.strict && found.length >= 200) context.incomplete.add("result limit reached");
      results.push(...found);
    }

    return results;
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

async function searchOrdersByCustomer(customerId: string, context: SearchContext): Promise<SearchCandidate[]> {
  if (!customerId || !customerId.trim()) {
    return [];
  }

  const baseUrl = getBaseUrl();
  const params = new URLSearchParams({
    "customer.id": customerId,
    recordLength: "500",
  });

  const url = `${baseUrl}/orders/search?${params.toString()}`;

  console.log("BUILD_PREVIEW_VERSION", BUILD_PREVIEW_VERSION);
  console.log("MCLEOD_CUSTOMER_BATCH_URL", url);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
      cache: "no-store",
    });
  } catch (error) {
    if (!context.strict) throw error;
    context.incomplete.add("network error");
    return [];
  }

  const text = await res.text();

  console.log("MCLEOD_CUSTOMER_BATCH_STATUS", res.status);
  console.log("MCLEOD_CUSTOMER_BATCH_BODY", text);

  if (!res.ok) {
    if (context.strict) context.incomplete.add(`HTTP ${res.status}`);
    console.warn("MCLEOD_CUSTOMER_BATCH_ERROR", res.status, text);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    if (!context.strict) throw error;
    context.incomplete.add("invalid JSON");
    return [];
  }
  if (context.strict && !extractSearchOrders(parsed)) {
    context.incomplete.add(unexpectedSearchShape(parsed));
    return [];
  }
  const rows = parseSearchRows(parsed);
  if (context.strict && rows.length >= 500) context.incomplete.add("result limit reached");

  const deduped = new Map<string, SearchCandidate>();

  for (const candidate of rows) {
    if (candidate.orderId) {
      deduped.set(candidate.orderId, candidate);
    }
  }

  return Array.from(deduped.values());
}

function enrichCandidates(
  candidates: SearchCandidate[],
  targetMark: string,
  targetBales: number | null
) {
  return candidates.map((candidate) => {
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

export async function buildPreview(rows: InboundExcelRow[], options: { strictSearch?: boolean } = {}): Promise<PreviewResult[]> {
  console.log("BUILD_PREVIEW_LOADED", BUILD_PREVIEW_VERSION);

  const results: PreviewResult[] = [];

  for (const row of rows) {
    const searchContext: SearchContext = { strict: options.strictSearch === true, incomplete: new Set() };
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

    const primaryCandidates = await searchOrders(
      resolvedCustomer.customerId,
      targetMark,
      searchContext
    );

    let globalCandidates: SearchCandidate[] = [];
    if (primaryCandidates.length === 0) {
      console.log("FALLBACK_SEARCH_TRIGGERED", targetMark);
      globalCandidates = await searchOrders("", targetMark, searchContext);
    }

    let allCandidates =
      primaryCandidates.length > 0 ? primaryCandidates : globalCandidates;

    let enriched = enrichCandidates(allCandidates, targetMark, targetBales);
    let exactMarkCandidates = enriched.filter((c) => c.exactMark);

    // A customer-filtered search can return partial mark hits. Before calling
    // the row outside-carrier, also inspect exact marks across all customers.
    if (options.strictSearch && exactMarkCandidates.length === 0 && primaryCandidates.length > 0) {
      globalCandidates = await searchOrders("", targetMark, searchContext);
      const combined = new Map([...primaryCandidates, ...globalCandidates]
        .map((candidate) => [candidate.orderId, candidate]));
      allCandidates = Array.from(combined.values());
      enriched = enrichCandidates(allCandidates, targetMark, targetBales);
      exactMarkCandidates = enriched.filter((c) => c.exactMark);
    }

    if (exactMarkCandidates.length === 0) {
      console.log("CUSTOMER_BATCH_FALLBACK_TRIGGERED", {
        customerId: resolvedCustomer.customerId,
        mark: targetMark,
      });

      const batchCandidates = await searchOrdersByCustomer(
        resolvedCustomer.customerId,
        searchContext
      );

      if (batchCandidates.length > 0) {
        allCandidates = batchCandidates;
        enriched = enrichCandidates(allCandidates, targetMark, targetBales);
        exactMarkCandidates = enriched.filter((c) => c.exactMark);
      }
    }

    if (exactMarkCandidates.length === 0) {
      if (searchContext.incomplete.size) {
        throw new Error(`McLeod search incomplete (${Array.from(searchContext.incomplete).join(", ")}); cannot classify outside carrier. Review McLeod search logs.`);
      }
      results.push({
        row,
        resolvedCustomer,
        candidateCount: 0,
        status: "No Match",
        matchedOrderId: null,
        reason: `No matches found anywhere for mark ${targetMark}`,
        parsedBlnum: null,
        proposed: null,
      });
      continue;
    }

    const correctCustomerMatches = exactMarkCandidates.filter(
      (c) => c.customerId === resolvedCustomer.customerId
    );

    const correctCustomerExactBaleMatches = correctCustomerMatches.filter(
      (c) => c.baleMatch === true
    );

    if (correctCustomerExactBaleMatches.length === 1) {
      const winner = correctCustomerExactBaleMatches[0];

      results.push({
        row,
        resolvedCustomer,
        candidateCount: correctCustomerMatches.length,
        status: "Matched",
        matchedOrderId: winner.orderId,
        reason:
          "Strong match under expected customer on exact mark and bale count",
        parsedBlnum: winner.parsedBlnum,
        proposed: buildProposed(winner),
      });
      continue;
    }

    if (correctCustomerMatches.length === 1) {
      const winner = correctCustomerMatches[0];

      results.push({
        row,
        resolvedCustomer,
        candidateCount: correctCustomerMatches.length,
        status: "Matched",
        matchedOrderId: winner.orderId,
        reason: "Exact match under expected customer",
        parsedBlnum: winner.parsedBlnum,
        proposed: buildProposed(winner),
      });
      continue;
    }

    if (correctCustomerMatches.length > 1) {
      const first =
        correctCustomerExactBaleMatches[0] ?? correctCustomerMatches[0];

      results.push({
        row,
        resolvedCustomer,
        candidateCount: correctCustomerMatches.length,
        status: "Possible Match",
        matchedOrderId: first.orderId,
        reason: "Multiple matches under expected customer",
        parsedBlnum: first.parsedBlnum,
        proposed: buildProposed(first),
      });
      continue;
    }

    const first = exactMarkCandidates[0];

    results.push({
      row,
      resolvedCustomer,
      candidateCount: exactMarkCandidates.length,
      status: "Possible Match",
      matchedOrderId: first.orderId,
      reason: "Match found under different customer",
      parsedBlnum: first.parsedBlnum,
      proposed: buildProposed(first),
    });
  }

  return results;
}
