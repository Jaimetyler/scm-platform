import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveCustomer } from "@/lib/mcleod/inbound/resolveCustomer";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function cleanText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function deriveDisposition(row: {
  disposition?: string | null;
  status?: string | null;
  matched_order_id?: string | null;
}) {
  if (row.disposition === "outside_carrier") return "outside_carrier";
  if (row.disposition === "confirmed_match") return "confirmed_match";
  if (row.status === "failed" && !row.matched_order_id) return "outside_carrier";
  return row.disposition ?? "unresolved";
}

function getCanonicalCustomer(rawShipper: string) {
  const resolved = resolveCustomer(rawShipper);
  let canonical = cleanText(resolved.canonicalCustomer);

  if (!canonical || canonical === rawShipper.toUpperCase()) {
    const upper = rawShipper.toUpperCase();

    if (
      upper.includes("BUNGE") ||
      upper.includes("GLENCORE") ||
      upper.includes("VITERRA")
    ) {
      canonical = "BUNGE";
    } else if (upper.includes("OLAM") || upper.includes("BRIGHTFIELD")) {
      canonical = "OLAM";
    } else if (
      (upper.includes("ED") && upper.includes("F")) ||
      upper.includes("EFDM") ||
      upper.includes("EDFM")
    ) {
      canonical = "ED&F MAN";
    } else if (upper.includes("STAPL")) {
      canonical = "STAPL";
    } else if (upper.includes("TOYO")) {
      canonical = "TOYO";
    } else if (upper.includes("COFCO") || upper.includes("NOBLE")) {
      canonical = "COFCO";
    } else if (upper.includes("ALLEN") || upper.includes("LDC")) {
      canonical = "LDC";
    }
  }

  if (!canonical) {
    canonical = rawShipper.toUpperCase();
  }

  return canonical;
}

function getOutcome(row: {
  status?: string | null;
  reason?: string | null;
  disposition?: string | null;
  derivedDisposition?: string | null;
  matched_order_id?: string | null;
}) {
  const status = String(row.status ?? "").toLowerCase();
  const reason = String(row.reason ?? "").toLowerCase();
  const disposition = String(
    row.derivedDisposition ?? row.disposition ?? ""
  ).toLowerCase();

  if (status === "skipped" && reason.includes("delivered")) {
    return "already_delivered";
  }

  if (disposition === "confirmed_match" || status === "processed") {
    return "matched";
  }

  if (disposition === "outside_carrier") {
    return "outside_carrier";
  }

  if (status === "needs_review") {
    return "needs_review";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "skipped") {
    return "skipped";
  }

  return "unknown";
}

function normalizeEquipmentType(value: string | null | undefined) {
  const raw = cleanText(value).toUpperCase();

  if (!raw) return "";

  if (
    raw === "V" ||
    raw === "VAN" ||
    raw === "VNS" ||
    raw.includes("VAN")
  ) {
    return "V";
  }

  if (
    raw === "F" ||
    raw === "FB" ||
    raw === "FLT" ||
    raw === "FLAT" ||
    raw === "FLATBED" ||
    raw.includes("FLAT")
  ) {
    return "F";
  }

  return raw;
}

function normalizePage(value: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function normalizePageSize(value: string | null) {
  const allowed = new Set([25, 50, 100, 200]);
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  const size = Math.floor(n);
  return allowed.has(size) ? size : 50;
}

type SortField =
  | "received_date"
  | "mark"
  | "shipper"
  | "bale_count"
  | "location"
  | "source_sheet"
  | "terminal"
  | "equipment_type"
  | "matched_order_id"
  | "status"
  | "disposition"
  | "seen_count"
  | "first_seen_at"
  | "last_seen_at"
  | "created_at";

function normalizeSortField(value: string | null): SortField {
  const allowed: SortField[] = [
    "received_date",
    "mark",
    "shipper",
    "bale_count",
    "location",
    "source_sheet",
    "terminal",
    "equipment_type",
    "matched_order_id",
    "status",
    "disposition",
    "seen_count",
    "first_seen_at",
    "last_seen_at",
    "created_at",
  ];

  if (value && allowed.includes(value as SortField)) {
    return value as SortField;
  }

  return "received_date";
}

function normalizeSortDir(value: string | null) {
  return value === "asc" ? "asc" : "desc";
}

type InboundHistoryRow = {
  id: string;
  received_date: string | null;
  mark: string | null;
  shipper: string | null;
  bale_count: number | null;
  location: string | null;
  source_sheet: string | null;
  terminal: string | null;
  equipment_type: string | null;
  matched_order_id: string | null;
  status: string | null;
  reason: string | null;
  disposition: string | null;
  seen_count: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_at?: string | null;
};

type EnrichedRow = InboundHistoryRow & {
  canonical_customer: string;
  derivedDisposition: string;
  outcome: string;
  normalized_equipment_type: string;
};

type CustomerGroup = {
  canonical: string;
  aliases: Set<string>;
};

function applySharedFilters(
  query: any,
  args: {
    startDate: string;
    endDate: string;
    customer: string;
    terminal: string;
    search: string;
    selectedAliases: string[];
  }
) {
  const { startDate, endDate, customer, terminal, search, selectedAliases } = args;

  let nextQuery = query;

  if (startDate) {
    nextQuery = nextQuery.gte("received_date", startDate);
  }

  if (endDate) {
    nextQuery = nextQuery.lte("received_date", endDate);
  }

  if (customer && selectedAliases.length > 0) {
    nextQuery = nextQuery.in("shipper", selectedAliases);
  }

  if (terminal) {
    nextQuery = nextQuery.eq("terminal", terminal);
  }

  if (search) {
    const escaped = search.replace(/[%_]/g, "");
    nextQuery = nextQuery.or(
      `mark.ilike.%${escaped}%,matched_order_id.ilike.%${escaped}%`
    );
  }

  return nextQuery;
}

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    const { searchParams } = new URL(req.url);

    const startDate = cleanText(searchParams.get("start_date"));
    const endDate = cleanText(searchParams.get("end_date"));
    const customer = cleanText(searchParams.get("customer"));
    const terminal = cleanText(searchParams.get("terminal"));
    const search = cleanText(searchParams.get("search"));

    const page = normalizePage(searchParams.get("page"));
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const sortBy = normalizeSortField(searchParams.get("sortBy"));
    const sortDir = normalizeSortDir(searchParams.get("sortDir"));
    const ascending = sortDir === "asc";
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: shipperRows, error: shipperError } = await sb
      .from("inbound_results")
      .select("shipper")
      .not("shipper", "is", null)
      .limit(5000);

    if (shipperError) {
      return NextResponse.json(
        { ok: false, error: shipperError.message },
        { status: 500 }
      );
    }

    const customerGroups = new Map<string, CustomerGroup>();

    for (const row of shipperRows ?? []) {
      const rawShipper = cleanText((row as { shipper?: string | null }).shipper);
      if (!rawShipper) continue;

      const canonical = getCanonicalCustomer(rawShipper);

      if (!customerGroups.has(canonical)) {
        customerGroups.set(canonical, {
          canonical,
          aliases: new Set<string>(),
        });
      }

      customerGroups.get(canonical)!.aliases.add(rawShipper);
    }

    const customers = Array.from(customerGroups.keys()).sort((a, b) =>
      a.localeCompare(b)
    );

    const selectedAliases =
      customer && customerGroups.has(customer)
        ? Array.from(customerGroups.get(customer)!.aliases)
        : [];

    const summaryBaseQuery = applySharedFilters(
      sb.from("inbound_results").select("*", { count: "exact" }),
      {
        startDate,
        endDate,
        customer,
        terminal,
        search,
        selectedAliases,
      }
    );

    const {
      data: summaryRawRows,
      error: summaryError,
      count,
    } = await summaryBaseQuery
      .order("received_date", { ascending: false })
      .order("mark", { ascending: true });

    if (summaryError) {
      return NextResponse.json(
        { ok: false, error: summaryError.message },
        { status: 500 }
      );
    }

    const allEnrichedRows: EnrichedRow[] = ((summaryRawRows ?? []) as InboundHistoryRow[]).map(
      (row) => {
        const rawShipper = cleanText(row.shipper);
        const derivedDisposition = deriveDisposition(row);
        const canonical_customer = rawShipper
          ? getCanonicalCustomer(rawShipper)
          : "";
        const outcomeValue = getOutcome({
          ...row,
          derivedDisposition,
        });

        return {
          ...row,
          canonical_customer,
          derivedDisposition,
          outcome: outcomeValue,
          normalized_equipment_type: normalizeEquipmentType(row.equipment_type),
        };
      }
    );

    const totalRows = typeof count === "number" ? count : allEnrichedRows.length;

    const totalBales = allEnrichedRows.reduce(
      (sum, row) => sum + Number(row.bale_count ?? 0),
      0
    );

    const scmTruckedRows = allEnrichedRows.filter(
      (r) =>
        r.outcome !== "outside_carrier" &&
        r.outcome !== "failed" &&
        r.outcome !== "needs_review" &&
        r.outcome !== "unknown"
    );

    const outsideCarrierRows = allEnrichedRows.filter(
      (r) => r.outcome === "outside_carrier"
    );

    const classifiedTotal = scmTruckedRows.length + outsideCarrierRows.length;

    const scmTruckedPct =
      classifiedTotal > 0
        ? Number(((scmTruckedRows.length / classifiedTotal) * 100).toFixed(1))
        : 0;

    const outsideCarrierPct =
      classifiedTotal > 0
        ? Number(((outsideCarrierRows.length / classifiedTotal) * 100).toFixed(1))
        : 0;

    let vanRows = 0;
    let flatRows = 0;
    let vanBales = 0;
    let flatBales = 0;

    for (const row of allEnrichedRows) {
      const eq = row.normalized_equipment_type;
      const bales = Number(row.bale_count ?? 0);

      if (eq === "V") {
        vanRows += 1;
        vanBales += bales;
      } else if (eq === "F") {
        flatRows += 1;
        flatBales += bales;
      }
    }

    const totalEquipmentRows = vanRows + flatRows;

    const equipmentSummary = {
      vanRows,
      flatRows,
      vanBales,
      flatBales,
      vanPct:
        totalEquipmentRows > 0
          ? Math.round((vanRows / totalEquipmentRows) * 100)
          : 0,
      flatPct:
        totalEquipmentRows > 0
          ? Math.round((flatRows / totalEquipmentRows) * 100)
          : 0,
    };

    const pagedBaseQuery = applySharedFilters(
      sb.from("inbound_results").select("*"),
      {
        startDate,
        endDate,
        customer,
        terminal,
        search,
        selectedAliases,
      }
    );

    const { data: pagedRawRows, error: pagedError } = await pagedBaseQuery
      .order(sortBy, { ascending })
      .order("mark", { ascending: true })
      .range(from, to);

    if (pagedError) {
      return NextResponse.json(
        { ok: false, error: pagedError.message },
        { status: 500 }
      );
    }

    const pagedRows: EnrichedRow[] = ((pagedRawRows ?? []) as InboundHistoryRow[]).map(
      (row) => {
        const rawShipper = cleanText(row.shipper);
        const derivedDisposition = deriveDisposition(row);
        const canonical_customer = rawShipper
          ? getCanonicalCustomer(rawShipper)
          : "";
        const outcomeValue = getOutcome({
          ...row,
          derivedDisposition,
        });

        return {
          ...row,
          canonical_customer,
          derivedDisposition,
          outcome: outcomeValue,
          normalized_equipment_type: normalizeEquipmentType(row.equipment_type),
        };
      }
    );

    const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));

    return NextResponse.json({
      ok: true,
      customers,
      summary: {
        totalRows,
        scmTruckedTotal: scmTruckedRows.length,
        outsideCarrierTotal: outsideCarrierRows.length,
        totalBales,
        scmTruckedPct,
        outsideCarrierPct,
        classifiedTotal,
        equipmentSummary,
      },
      pagination: {
        page,
        pageSize,
        pageCount,
        totalRows,
        hasPrevPage: page > 1,
        hasNextPage: page < pageCount,
      },
      sort: {
        sortBy,
        sortDir,
      },
      rows: pagedRows,
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