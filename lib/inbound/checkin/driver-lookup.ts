import { dependencyFetch, DependencyError } from "../../http/dependency.ts";
import { mapLimit } from "../../http/map-limit.ts";
import { extractSearchOrders } from "../../mcleod/inbound/search-response.ts";
import { lookupMcleodGateOrder } from "./mcleod-order-id.ts";
import { mcleodOrderStops, YardStopError } from "./yard-stop.ts";
import { CHECKIN_SITES } from "./sites.ts";
import { referenceMatchesInput } from "./reference-match.ts";
import { searchReferenceOrders } from "./reference-search.ts";

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => text(value).toUpperCase();
const validId = (value: string) => /^[A-Za-z0-9_-]{1,60}$/.test(value);
const unavailable = () => new DependencyError("The complete SCM lookup is temporarily unavailable. Please try again or ask warehouse staff.");
export type DriverLookupMatch = {
  orderId: string;
  stopId: string;
  matchedBy: ("scm_order" | "reference")[];
  order: Awaited<ReturnType<typeof lookupMcleodGateOrder>>;
  selectable: boolean;
};

/** One input, two independent strategies. Never infer its meaning from numeric shape.
 * Both strategies and every candidate must finish before a confirmed no-match is safe.
 * At most 20 reference pages of 5 raw rows, one exact-ID search, and 21 distinct
 * detail requests (20 true reference IDs + one exact ID), four at once. Search,
 * body consumption, details, and optional enrichment share a 20-second deadline. */
export async function lookupDriverReference(input: string, terminal: "SAV" | "HOU", siteName: string,
  direction: "pickup" | "delivery", selection?: { orderId: string; stopId?: string }) {
  const originalInput = text(input);
  const reference = key(input);
  if (reference.length < 3 || reference.length > 120 || /[\u0000-\u001f*?]/.test(reference))
    throw new YardStopError("Enter 3 to 120 characters from your pickup / delivery reference or SCM order number, without wildcards.", "INVALID_LOOKUP_INPUT");
  if (direction !== "pickup" && direction !== "delivery")
    throw new YardStopError("Choose pickup or delivery.", "INVALID_DIRECTION");
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw unavailable();
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  try {
  const read = async (path: string) => {
    try {
      signal.throwIfAborted();
      const response = await dependencyFetch(`${base}${path}`, { headers, cache: "no-store", signal });
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch { throw unavailable(); }
  };
  const field = direction === "pickup" ? "blnum" : "consignee_refno";
  type Candidate = { orderId: string; paths: DriverLookupMatch["matchedBy"] };
  const readExactIds = async () => {
    if (!validId(reference)) return [];
    // Discover IDs through the documented exact-field search contract. The
    // absence status/body of GET /orders/{id} is not assumed for arbitrary input.
    const query = new URLSearchParams({ "orders.id": reference, recordLength: "2" });
    const exactIds = extractSearchOrders(await read(`/orders/search?${query}`));
    // A unique exact ID can yield zero or one row. Unexpected IDs/duplicates or
    // malformed search data are uncertainty, never permission for outside freight.
    if (!exactIds || exactIds.length > 1 || exactIds.some(item => !item || typeof item !== "object" ||
      Array.isArray(item) || typeof (item as any).id !== "string" || key((item as any).id) !== reference ||
      typeof (item as any).revenue_code_id !== "string" || !text((item as any).revenue_code_id)))
      throw unavailable();
    return exactIds as Record<string, any>[];
  };
  // Exact-ID and reference searches stay independent. A whole-field reference
  // match never suppresses other orders with the same whole token in a list.
  const [exactIds, referenceRows] = await Promise.all([
    readExactIds(), searchReferenceOrders(read, field, reference, signal),
  ]);
  const candidates = new Map<string, Candidate>(referenceRows.map(row =>
    [key(row.id), { orderId: text(row.id), paths: ["reference"] }]));
  const validateOrder = (order: any, expectedId: string) => {
    if (!order || typeof order !== "object" || Array.isArray(order) || typeof order.id !== "string" ||
      key(order.id) !== key(expectedId) || typeof order.revenue_code_id !== "string" || !text(order.revenue_code_id))
      throw unavailable();
    return order as Record<string, any>;
  };
  if (exactIds.length === 1) {
    const id = text(exactIds[0].id);
    const prior = candidates.get(key(id));
    candidates.set(key(id), { orderId: id, paths: prior ? ["scm_order", "reference"] : ["scm_order"] });
  }
  const blocked: YardStopError[] = [];
  // Offset pagination is not a snapshot: sorting/overlap checks cannot detect
  // every concurrent insert/delete. Every selected lookup/submission reruns this
  // search and rehydrates its order/stop; no earlier lookup grants authorization.
  const orderedCandidates = [...candidates.values()].sort((left, right) =>
    key(left.orderId) < key(right.orderId) ? -1 : key(left.orderId) > key(right.orderId) ? 1 : 0);
  const resolved = await mapLimit(orderedCandidates, 4, async candidate => {
    const raw = validateOrder(await read(`/orders/${encodeURIComponent(candidate.orderId)}`), candidate.orderId);
    // A changed search/detail snapshot is not proof that the submitted input has no match.
    if (candidate.paths.includes("reference") && (typeof raw[field] !== "string" || !referenceMatchesInput(raw[field], reference))) throw unavailable();
    if (key(raw.revenue_code_id) !== "MAIN") {
      blocked.push(new YardStopError("A matching order is not eligible for this SCM freight check-in. Please speak with warehouse staff.", "NOT_MAIN_ORDER"));
      return null;
    }
    if (!text(raw[field]) || !text(raw.customer?.name ?? raw.customer_name ?? raw.customer_id)) throw unavailable();
    // An empty/partial detail response cannot prove that an alternative candidate
    // belongs elsewhere. Never silently turn unknown yard evidence into a unique match.
    const stops = mcleodOrderStops(raw);
    if (!stops.length || stops.some(stop => !text(stop.id) || !text(stop.stop_type) ||
      ["PU", "SO"].includes(stop.stop_type) && !hasLocationEvidence(stop))) throw unavailable();
    try {
      const selectedStop = selection && key(selection.orderId) === key(candidate.orderId) ? selection.stopId : undefined;
      const order = await lookupMcleodGateOrder(candidate.orderId, terminal, siteName, direction, selectedStop, raw, signal);
      const date = order.orderDate.match(/^(\d{4})(\d{2})(\d{2})/);
      const scheduled = date ? Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) : Date.parse(order.orderDate);
      if (!order.completion && Number.isFinite(scheduled) && scheduled < Date.now() - 45 * 86400000) {
        blocked.push(new YardStopError("A matching order is historical. Please speak with warehouse staff.", "HISTORICAL_ORDER"));
        return null;
      }
      return { orderId: candidate.orderId, stopId: order.stopId, matchedBy: candidate.paths, order, selectable: !order.completion } as DriverLookupMatch;
    } catch (error) {
      if (error instanceof YardStopError && error.code === "YARD_STOP_NOT_FOUND") {
        blocked.push(error);
        return null;
      }
      throw error;
    }
  });
  if (signal.aborted) throw unavailable();
  const matches = [...new Map(resolved.filter((value): value is DriverLookupMatch => value !== null)
    .map(value => [`${key(value.orderId)}\u0000${value.stopId}`, value])).values()];
  if (!matches.length && blocked.length) throw blocked[0];
  const active = matches.filter(value => !value.order.completion);
  if (active.length > 1) {
    // Company + driver identity is the only driver-facing discriminator.
    // Identical or missing identities require the office, not an order-number guess.
    const identities = active.map(value => driverIdentity(value));
    active.forEach((value, index) => {
      const identity = identities[index];
      value.selectable = Boolean(identity.carrier && (identity.name || identity.phone)) &&
        identities.every((other, otherIndex) => otherIndex === index || distinguishableDrivers(identity, other));
    });
  }
  return { originalInput, matches, allowUnmatched: candidates.size === 0, selectionRequired: active.length > 1 };
  } finally {
    // A failed strategy cancels other in-flight reads and enrichment immediately.
    controller.abort();
  }
}

function hasLocationEvidence(stop: Record<string, any>) {
  const location = stop.location && typeof stop.location === "object" ? stop.location : {};
  const name = key(location.name || stop.location_name);
  if (!name) return false;
  if (!/\bSCM\b|SUPPLY CHAIN|SAVANNAH WAREHOUSE|HOUSTON WAREHOUSE/.test(name)) return true;
  const address = [name, location.address, location.address1, location.address2, stop.address].map(text).join(" ");
  return CHECKIN_SITES.some(site => new RegExp(`(^|\\D)${site.siteCode}(\\D|$)`).test(address));
}
function driverIdentity(match: DriverLookupMatch) {
  const { carrierName, driverName, driverPhone } = match.order;
  return { carrier: key(carrierName).replace(/\s+/g, " "), name: key(driverName).replace(/\s+/g, " "), phone: phoneLast4(driverPhone) };
}
function distinguishableDrivers(left: ReturnType<typeof driverIdentity>, right: ReturnType<typeof driverIdentity>) {
  // Missing data is compatible with known data, never evidence of a different driver.
  return Boolean(left.carrier && right.carrier && left.carrier !== right.carrier ||
    left.name && right.name && left.name !== right.name || left.phone && right.phone && left.phone !== right.phone);
}
function phoneLast4(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

/** Public gate users receive only the information needed to recognize their load. */
export function publicDriverMatch(match: DriverLookupMatch) {
  const { order } = match;
  return { orderId: match.orderId, stopId: match.stopId, matchedBy: match.matchedBy, selectable: match.selectable,
    carrierName: order.carrierName, driverName: order.driverName, driverPhoneLast4: phoneLast4(order.driverPhone),
    completion: order.completion ? publicDriverCompletion(order.completion) : null };
}
export function publicDriverCompletion(completion: NonNullable<DriverLookupMatch["order"]["completion"]>) {
  return { kind: completion.kind, message: completion.message, completedAt: completion.completedAt,
    location: completion.location, carrierName: completion.carrierName, carrierCode: "" };
}

export function selectDriverMatch(result: Awaited<ReturnType<typeof lookupDriverReference>>, orderId: string, stopId?: string, explicitSelection = false) {
  const matches = result.matches.filter(match => key(match.orderId) === key(orderId) && (!stopId || match.stopId === stopId));
  if (matches.length !== 1) throw new YardStopError("Your selected load no longer matches the entered reference or SCM order number. Look it up again.", "STALE_ORDER_SELECTION");
  const match = matches[0];
  if (!match.order.completion && !match.selectable)
    throw new YardStopError("These loads have the same or incomplete trucking company and driver details. Please contact the office to identify your load.", "AMBIGUOUS_DRIVER_IDENTITY");
  if (!match.order.completion && result.selectionRequired && !explicitSelection)
    throw new YardStopError("More than one load now matches. Look it up again and confirm your trucking company and driver details.", "SELECTION_REQUIRED");
  return match;
}
