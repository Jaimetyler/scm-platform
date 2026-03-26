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

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    const { searchParams } = new URL(req.url);

    const startDate = cleanText(searchParams.get("start_date"));
    const endDate = cleanText(searchParams.get("end_date"));
    const customer = cleanText(searchParams.get("customer"));
    const terminal = cleanText(searchParams.get("terminal"));
    const search = cleanText(searchParams.get("search"));

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
      const rawShipper = cleanText(row.shipper);
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

    let baseQuery = sb.from("inbound_results").select("*", { count: "exact" });

    if (startDate) {
      baseQuery = baseQuery.gte("received_date", startDate);
    }

    if (endDate) {
      baseQuery = baseQuery.lte("received_date", endDate);
    }

    if (customer && selectedAliases.length > 0) {
      baseQuery = baseQuery.in("shipper", selectedAliases);
    }

    if (terminal) {
      baseQuery = baseQuery.eq("terminal", terminal);
    }

    if (search) {
      const escaped = search.replace(/[%_]/g, "");
      baseQuery = baseQuery.or(
        `mark.ilike.%${escaped}%,matched_order_id.ilike.%${escaped}%`
      );
    }

    const { data: rawRows, error: rawRowsError, count } = await baseQuery
      .order("received_date", { ascending: false })
      .order("mark", { ascending: true })
      .limit(5000);

    if (rawRowsError) {
      return NextResponse.json(
        { ok: false, error: rawRowsError.message },
        { status: 500 }
      );
    }

    const enrichedRows: EnrichedRow[] = ((rawRows ?? []) as InboundHistoryRow[]).map(
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

    const totalRows = typeof count === "number" ? count : enrichedRows.length;

    const totalBales = enrichedRows.reduce(
      (sum, row) => sum + Number(row.bale_count ?? 0),
      0
    );

    const matchedRows = enrichedRows.filter((r) => r.outcome === "matched");
    const outsideCarrierRows = enrichedRows.filter(
      (r) => r.outcome === "outside_carrier"
    );

    let vanRows = 0;
    let flatRows = 0;
    let vanBales = 0;
    let flatBales = 0;

    for (const row of enrichedRows) {
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

    return NextResponse.json({
      ok: true,
      customers,
      summary: {
        totalRows,
        matchedTotal: matchedRows.length,
        outsideCarrierTotal: outsideCarrierRows.length,
        totalBales,
        equipmentSummary,
      },
      rows: enrichedRows.slice(0, 2000),
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