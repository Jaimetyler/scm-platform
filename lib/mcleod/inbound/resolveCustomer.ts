import { CUSTOMER_XREF } from "./xref";

export type ResolvedCustomer = {
  canonicalCustomer: string;
  customerId: string;
  customerName: string;
};

type NormalizedRow = {
  aliasRaw: string;
  aliasNormalized: string;
  canonicalCustomer: string;
  customerId: string;
  customerName: string;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[.,/()-]/g, " ")
    .replace(/\bAND\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+/g, "");
}

function standardizeCanonical(value: string | null | undefined) {
  const upper = String(value ?? "").trim().toUpperCase();

  if (!upper) return "UNKNOWN";

  if (
    upper.includes("BUNGE") ||
    upper.includes("GLENCORE") ||
    upper.includes("VITERRA")
  ) {
    return "BUNGE";
  }

  if (upper.includes("OLAM") || upper.includes("BRIGHTFIELD")) {
    return "OLAM";
  }

  if (upper.includes("COFCO") || upper.includes("NOBLE")) {
    return "COFCO";
  }

  if (upper.includes("STAPL")) {
    return "STAPL";
  }

  if (upper.includes("TOYO")) {
    return "TOYO";
  }

  if (
    (upper.includes("ED") && upper.includes("F")) ||
    upper.includes("EFDM") ||
    upper.includes("EDFM")
  ) {
    return "ED&F MAN";
  }

  if (upper.includes("LDC") || upper.includes("ALLEN")) {
    return "LDC";
  }

  if (upper.includes("BACO")) {
    return "BACO";
  }

  if (upper.includes("ADM")) {
    return "ADM";
  }

  if (upper.includes("MEMTEX") || upper === "MEM") {
    return "MEMTEX";
  }

  if (upper.includes("TERRA") || upper.includes("NOVA")) {
    return "TERRA NOVA";
  }

  if (upper.includes("WHITE")) {
    return "WHITE GOLD";
  }

  return upper;
}

const NORMALIZED_XREF: NormalizedRow[] = CUSTOMER_XREF.filter(
  (row) => row.active !== false
).map((row) => ({
  aliasRaw: String(row.alias ?? "").trim(),
  aliasNormalized: normalize(row.alias),
  canonicalCustomer: standardizeCanonical(row.canonicalCustomer),
  customerId: String(row.customerId ?? "").trim(),
  customerName: String(row.customerName ?? "").trim(),
}));

function exactMatch(normalizedInput: string): NormalizedRow | null {
  for (const row of NORMALIZED_XREF) {
    if (row.aliasNormalized && row.aliasNormalized === normalizedInput) {
      return row;
    }
  }
  return null;
}

function containsMatch(normalizedInput: string): NormalizedRow | null {
  const candidates = NORMALIZED_XREF
    .filter((row) => row.aliasNormalized.length >= 5)
    .sort((a, b) => b.aliasNormalized.length - a.aliasNormalized.length);

  for (const row of candidates) {
    if (
      row.aliasNormalized &&
      (normalizedInput.includes(row.aliasNormalized) ||
        row.aliasNormalized.includes(normalizedInput))
    ) {
      return row;
    }
  }

  return null;
}

export function resolveCustomer(
  rawValue: string | null | undefined
): ResolvedCustomer {
  const raw = String(rawValue ?? "").trim();
  const normalizedInput = normalize(raw);

  if (!normalizedInput) {
    return {
      canonicalCustomer: "UNKNOWN",
      customerId: "UNKNOWN",
      customerName: "UNKNOWN",
    };
  }

  const exact = exactMatch(normalizedInput);
  if (exact) {
    return {
      canonicalCustomer: standardizeCanonical(exact.canonicalCustomer),
      customerId: exact.customerId,
      customerName: exact.customerName,
    };
  }

  const contains = containsMatch(normalizedInput);
  if (contains) {
    return {
      canonicalCustomer: standardizeCanonical(contains.canonicalCustomer),
      customerId: contains.customerId,
      customerName: contains.customerName,
    };
  }

  return {
    canonicalCustomer: standardizeCanonical(raw),
    customerId: raw.toUpperCase().replace(/\s+/g, ""),
    customerName: raw,
  };
}