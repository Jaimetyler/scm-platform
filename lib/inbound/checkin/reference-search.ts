import { DependencyError } from "../../http/dependency.ts";
import { extractSearchOrders } from "../../mcleod/inbound/search-response.ts";
import { normalizeReference, referenceMatchesInput } from "./reference-match.ts";
import { YardStopError } from "./yard-stop.ts";

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => text(value).toUpperCase();
const validId = (value: string) => /^[A-Za-z0-9_-]{1,60}$/.test(value);
const PAGE_SIZE = 5;
const MAX_PAGES = 20;
const MAX_RAW_ROWS = 100;
const MAX_TRUE_CANDIDATES = 20;
const unavailable = () => new DependencyError("The reference search could not be completed safely. Please try again or ask warehouse staff.");
const tooManyMatches = () => new YardStopError("Too many matching orders. Enter a longer reference or ask warehouse staff.", "TOO_MANY_MATCHES");
const incomplete = () => new YardStopError("The reference search is too broad to finish safely. Enter a longer reference or ask warehouse staff.", "INCOMPLETE_LOOKUP");

/** Shared bounded candidate retrieval for driver and staff reference lookups.
 * Callers supply a read-only JSON reader and one deadline signal covering the
 * complete lookup, including all fields, order hydration and carrier enrichment.
 * Return only after a short/empty page establishes complete retrieval within
 * 20 pages / 100 raw rows, with at most 20 distinct true reference candidates. */
export async function searchReferenceOrders(
  readPath: (path: string) => Promise<unknown>,
  field: "blnum" | "consignee_refno",
  input: string,
  signal: AbortSignal,
): Promise<Record<string, any>[]> {
  const reference = key(input);
  if (!reference || /[\u0000-\u001f*?]/.test(reference))
    throw new YardStopError("Enter a reference without wildcards or control characters.", "INVALID_LOOKUP_INPUT");
  // Every exact normalized compound contains each literal slash component.
  // Search its longest component as a likely-selective necessary anchor, then
  // validate the entire compound locally. Searching the formatted full input
  // would miss other slash spacing; OR-ing components would accept contradictions.
  // Do not split meaningful hyphenated references, assume rarity, or claim that a
  // full anchor page proves completeness. The original stored value is returned.
  const normalized = normalizeReference(reference);
  const anchor = normalized.split("/").find(Boolean) || normalized;
  const candidates = new Map<string, Record<string, any>>();
  const seenIds = new Set<string>();
  let scannedRows = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (signal.aborted) throw unavailable();
    // Documented McLeod /orders/search pagination; omitted orderBy defaults to
    // orders.id descending. Explicit overrides failed the live read-only A/B
    // while offset-only requests succeeded, so rely on that documented default.
    // https://tms-dsly.loadtracking.com/ws/docs/services?operation=getOrdersByAdvancedSearch&role=-1&service=OrderService
    // No assumed OR/regex/date/yard filtering. Anchor retrieval is filtered locally.
    const query = new URLSearchParams({ [`orders.${field}`]: `*${anchor}*`,
      recordLength: String(PAGE_SIZE), recordOffset: String(scannedRows) });
    let payload: unknown;
    try { payload = await readPath(`/orders/search?${query}`); }
    catch { throw unavailable(); }
    if (signal.aborted) throw unavailable();
    const rows = extractSearchOrders(payload);
    if (!rows || rows.length > PAGE_SIZE) throw unavailable();
    scannedRows += rows.length;
    if (scannedRows > MAX_RAW_ROWS) throw incomplete();
    const pageIds = new Map<string, string>();
    for (const item of rows) {
      // Validate every broad result before discarding false substring hits. An
      // unknown reference or ID cannot establish either a unique match or absence.
      if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof (item as any).id !== "string" || !validId(text((item as any).id)) ||
        typeof (item as any).revenue_code_id !== "string" || !text((item as any).revenue_code_id) ||
        typeof (item as any)[field] !== "string" || !text((item as any)[field])) throw unavailable();
      const row = item as Record<string, any>;
      const idKey = key(row.id);
      const fingerprint = JSON.stringify(sortedObject(row));
      // A repeated/overlapping page is not progress. It can mean ignored offsets
      // or data moving between pages; never silently deduplicate it into success.
      // Do not guess the vendor DB's ID collation with a JavaScript comparator.
      if (seenIds.has(idKey) || pageIds.has(idKey) && pageIds.get(idKey) !== fingerprint) throw unavailable();
      pageIds.set(idKey, fingerprint);
      if (!referenceMatchesInput(row[field], reference)) continue;
      candidates.set(idKey, row);
      if (candidates.size > MAX_TRUE_CANDIDATES) throw tooManyMatches();
    }
    for (const id of pageIds.keys()) seenIds.add(id);
    // Only a short/empty page establishes exhaustion. A full last budget page
    // must fail closed even when it contains zero true reference candidates.
    if (rows.length < PAGE_SIZE) return [...candidates.values()];
  }
  throw incomplete();
}

// Search JSON is acyclic. Compare duplicate evidence independently of object
// key insertion order, while preserving meaningful list ordering and values.
function sortedObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, child]) => [name, sortedObject(child)]));
  return value;
}
