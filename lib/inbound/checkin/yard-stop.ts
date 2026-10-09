import { CHECKIN_SITES } from "./sites.ts";
type RecordValue = Record<string, any>;
export class YardStopError extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.name = "YardStopError"; this.code = code; }
}
const text = (value: unknown) => String(value ?? "").trim();

/** McLeod may expose stops at the order root, within movements, or both. */
export function mcleodOrderStops(order: RecordValue): RecordValue[] {
  const byId = new Map<string, RecordValue>();
  const withoutId: RecordValue[] = [];
  const add = (stop: RecordValue, movementId?: string) => {
    if (!stop || typeof stop !== "object") return;
    if (movementId && text(stop.movement_id) && text(stop.movement_id) !== movementId)
      throw new YardStopError("The stop conflicts with its enclosing movement. Staff must review it.", "CONFLICTING_STOP_IDENTITY");
    const normalized: RecordValue = { ...stop, ...(movementId && !stop.movement_id ? { movement_id: movementId } : {}) };
    const id = text(stop.id);
    if (!id) { withoutId.push(normalized); return; }
    const previous = byId.get(id);
    if (previous && ((previous.movement_id && normalized.movement_id && text(previous.movement_id) !== text(normalized.movement_id)) ||
        (previous.stop_type && normalized.stop_type && previous.stop_type !== normalized.stop_type))) {
      throw new YardStopError("The order has conflicting stop details. Staff must review it.", "CONFLICTING_STOP_IDENTITY");
    }
    if (previous && ["actual_arrival", "actual_departure"].some(field => Object.hasOwn(previous, field) && Object.hasOwn(normalized, field) && text(previous[field]) !== text(normalized[field]))) {
      throw new YardStopError("The order has conflicting stop actuals. Staff must review it.", "CONFLICTING_STOP_IDENTITY");
    }
    if (previous) {
      const priorLocation = previous.location && typeof previous.location === "object" ? previous.location : {};
      const nextLocation = normalized.location && typeof normalized.location === "object" ? normalized.location : {};
      const canonical = (value: unknown) => text(value).replace(/\s+/g, " ").toUpperCase();
      const overlapConflict = ["id", "code", "address", "address1", "address2", "name", "city", "city_name", "state"].some(field =>
        text(priorLocation[field]) && text(nextLocation[field]) && canonical(priorLocation[field]) !== canonical(nextLocation[field]));
      const priorName = priorLocation.name || previous.location_name, nextName = nextLocation.name || normalized.location_name;
      const priorCity = priorLocation.city_name || priorLocation.city || previous.city_name, nextCity = nextLocation.city_name || nextLocation.city || normalized.city_name;
      if (overlapConflict || text(priorCity) && text(nextCity) && canonical(priorCity) !== canonical(nextCity) || text(priorName) && text(nextName) && canonical(priorName) !== canonical(nextName))
        throw new YardStopError("The order has conflicting stop locations. Staff must review it.", "CONFLICTING_STOP_IDENTITY");
    }
    byId.set(id, { ...previous, ...normalized, location: {
      ...(previous?.location && typeof previous.location === "object" ? previous.location : {}),
      ...(normalized.location && typeof normalized.location === "object" ? normalized.location : {}),
    } });
  };
  for (const stop of Array.isArray(order.stops) ? order.stops : []) add(stop);
  for (const movement of Array.isArray(order.movements) ? order.movements : []) {
    for (const stop of Array.isArray(movement.stops) ? movement.stops : []) add(stop, text(movement.id));
  }
  return [...byId.values(), ...withoutId];
}

export function stopAtScmYard(stop: RecordValue, siteName: string, terminal?: "SAV" | "HOU"): boolean {
  const location = stop.location && typeof stop.location === "object" ? stop.location : {};
  const name = text(location.name ?? stop.location_name).toUpperCase();
  const address = [location.address, location.address1, location.address2, stop.address].map(text).join(" ").toUpperCase();
  const siteWords: string[] = siteName.toUpperCase().match(/\b\d{3,}\b/g) ?? [];
  const city = text(location.city_name || location.city || stop.city_name).toUpperCase();
  const state = text(location.state || stop.state).toUpperCase();
  const expected = terminal || (/HOUSTON/i.test(siteName) ? "HOU" : /SAVANNAH/i.test(siteName) ? "SAV" : undefined);
  if (expected === "HOU" && (/SAVANNAH/.test(`${name} ${city}`) || /^(GA|GEORGIA)$/.test(state)) ||
      expected === "SAV" && (/HOUSTON/.test(`${name} ${city}`) || /^(TX|TEXAS)$/.test(state))) return false;
  // A numeric database identifier is not yard/address evidence. An explicit
  // different known SCM yard in the location name overrides an address hit.
  const knownYards = CHECKIN_SITES.map(site => site.siteCode);
  if (knownYards.some(yard => !siteWords.includes(yard) && new RegExp(`(^|\\D)${yard}(\\D|$)`).test(name))) return false;
  return /\bSCM\b|SUPPLY CHAIN|SAVANNAH WAREHOUSE|HOUSTON WAREHOUSE/.test(name) &&
    siteWords.some(word => new RegExp(`(^|\\D)${word}(\\D|$)`).test(`${name} ${address}`));
}

/** Direction is applied BEFORE counting matches. Repeated same-direction visits need explicit selection. */
export function selectMcleodYardStop(order: RecordValue, terminal: "SAV" | "HOU", siteName: string,
  direction?: "pickup" | "delivery", selectedStopId?: string | null) {
  if (!["SAV", "HOU"].includes(terminal)) throw new YardStopError("Choose a valid terminal.", "INVALID_TERMINAL");
  const stops = mcleodOrderStops(order);
  const candidates = stops.filter(stop => (stop.stop_type === "PU" || stop.stop_type === "SO") &&
    (!direction || stop.stop_type === (direction === "pickup" ? "PU" : "SO")) && stopAtScmYard(stop, siteName, terminal));
  const matches = selectedStopId ? candidates.filter(stop => text(stop.id) === selectedStopId) : candidates;
  if (matches.length !== 1 || !text(matches[0]?.id)) {
    throw new YardStopError(selectedStopId ? "The selected stop no longer matches this yard and direction. Look up the order again." :
      candidates.length > 1 ? "This order visits this yard more than once. Staff must select the correct stop." :
      "Could not identify this SCM yard and direction on the order. Check the reference from your paperwork.",
      selectedStopId ? "STALE_STOP_SELECTION" : candidates.length > 1 ? "AMBIGUOUS_YARD_STOP" : "YARD_STOP_NOT_FOUND");
  }
  const stop = matches[0];
  const movements: RecordValue[] = Array.isArray(order.movements) ? order.movements : [];
  const linked = movements.filter(movement => text(stop.movement_id) ? text(movement.id) === text(stop.movement_id) :
    Array.isArray(movement.stops) && movement.stops.some((item: RecordValue) => text(item.id) === text(stop.id)));
  const movement = linked.length === 1 ? linked[0] : !text(stop.movement_id) && movements.length === 1 && !Array.isArray(movements[0].stops) ? movements[0] : undefined;
  return { stop, movement, stops, direction: stop.stop_type === "PU" ? "pickup" as const : "delivery" as const };
}
