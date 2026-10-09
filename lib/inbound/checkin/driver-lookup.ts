import { dependencyFetch, DependencyError } from "../../http/dependency.ts";
import { mapLimit } from "../../http/map-limit.ts";
import { extractSearchOrders } from "../../mcleod/inbound/search-response.ts";
import { lookupMcleodGateOrder } from "./mcleod-order-id.ts";
import { mcleodOrderStops, YardStopError } from "./yard-stop.ts";
import { CHECKIN_SITES } from "./sites.ts";

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
 * At most 21 distinct detail requests, four at once, under one 20-second deadline. */
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
  const missing = Symbol("confirmed absent or invalid ID syntax");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  try {
  const read = async (path: string, missingAllowed = false) => {
    try {
      signal.throwIfAborted();
      const response = await dependencyFetch(`${base}${path}`, { headers, cache: "no-store", signal });
      if (missingAllowed && response.status === 404) return missing;
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch { throw unavailable(); }
  };
  const field = direction === "pickup" ? "blnum" : "consignee_refno";
  const query = new URLSearchParams({ [`orders.${field}`]: `*${reference}*`, recordLength: "200" });
  const [direct, searchPayload] = await Promise.all([
    validId(reference) ? read(`/orders/${encodeURIComponent(reference)}`, true) : Promise.resolve(missing),
    read(`/orders/search?${query}`),
  ]);
  const search = extractSearchOrders(searchPayload);
  if (!search) throw new DependencyError("McLeod returned an unexpected search response. Please try again; this is not a confirmed no-match.");
  if (search.length >= 200)
    throw new YardStopError("Too many possible orders. Enter a longer reference or ask warehouse staff.", "TOO_MANY_MATCHES");
  if (search.some(item => !item || typeof item !== "object" || !validId(text((item as any).id)) ||
    !text((item as any).revenue_code_id) || !text((item as any)[field])))
    throw new DependencyError("McLeod returned incomplete search details. Please try again or ask warehouse staff; this is not a confirmed no-match.");
  const validateOrder = (order: any, expectedId: string) => {
    if (!order || typeof order !== "object" || Array.isArray(order) || key(order.id) !== key(expectedId) || !text(order.revenue_code_id))
      throw unavailable();
    return order as Record<string, any>;
  };
  if (direct !== missing) validateOrder(direct, reference);
  const candidates = new Map<string, { orderId: string; paths: DriverLookupMatch["matchedBy"]; raw?: Record<string, any> }>();
  for (const item of search as Record<string, any>[]) {
    if (!key(item[field]).includes(reference)) continue;
    const id = text(item.id);
    candidates.set(key(id), { orderId: id, paths: ["reference"] });
  }
  if (candidates.size > 20)
    throw new YardStopError("Too many possible orders. Enter a longer reference or ask warehouse staff.", "TOO_MANY_MATCHES");
  if (direct !== missing) {
    const prior = candidates.get(reference);
    candidates.set(reference, { orderId: text(direct.id), paths: prior ? ["scm_order", "reference"] : ["scm_order"], raw: direct });
  }
  const blocked: YardStopError[] = [];
  const resolved = await mapLimit([...candidates.values()], 4, async candidate => {
    const raw = candidate.raw || validateOrder(await read(`/orders/${encodeURIComponent(candidate.orderId)}`), candidate.orderId);
    if (key(raw.revenue_code_id) !== "MAIN") {
      blocked.push(new YardStopError("A matching order is not eligible for this SCM freight check-in. Please speak with warehouse staff.", "NOT_MAIN_ORDER"));
      return null;
    }
    // A changed search/detail snapshot is not proof that the submitted input has no match.
    if (candidate.paths.includes("reference") && !key(raw[field]).includes(reference)) throw unavailable();
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
