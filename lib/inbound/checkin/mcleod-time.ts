// Format an instant for McLeod in the warehouse's local time, including the
// correct offset on either side of daylight saving transitions.
export function formatWarehouseTime(instant: Date, terminal: "SAV" | "HOU") {
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid check-in time");
  const timeZone = terminal === "SAV" ? "America/New_York" : "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  const yyyy = get("year"), mm = get("month"), dd = get("day");
  const hh = get("hour"), mi = get("minute"), ss = get("second");
  const localAsUtc = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
  const offset = Math.round((localAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const zoneOffset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`;
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}${zoneOffset}`;
}

type StopActuals = { id?: string; actual_arrival?: string | null; actual_departure?: string | null };
type StopPlan = { stopId: string; skipped: boolean; arrivalDate: string; departureDate: string;
  generatedArrival: boolean; generatedDeparture: boolean };

function warehouseWallTime(day: string, hour: number, minute: number, terminal: "SAV" | "HOU") {
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day)
    throw new Error("Invalid received date - cannot backfill pickup actuals");
  const wall = date.getTime() + (hour * 60 + minute) * 60000;
  let instant = wall;
  // Resolve the warehouse offset on the fallback day itself, including DST.
  for (let i = 0; i < 3; i++) {
    const stamp = formatWarehouseTime(new Date(instant), terminal);
    const offset = stamp.slice(-5);
    const minutes = (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3))) * (offset[0] === "+" ? 1 : -1);
    instant = wall - minutes * 60000;
  }
  return formatWarehouseTime(new Date(instant), terminal);
}

function actualInstant(raw: string) {
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  const iso = compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}${compact[7]}` : raw;
  // Never interpret an offset-free actual using the server's local timezone.
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso) || !Number.isFinite(Date.parse(iso)))
    throw new Error("An existing McLeod actual time could not be verified; review it before completing delivery");
  return Date.parse(iso);
}

// Planning is pure: preserve every existing actual, fill only missing values,
// and validate the entire timeline before either stop is written.
export function planLiveDeliveryActuals(input: {
  receivedDate: string; terminal: "SAV" | "HOU";
  checkedInAt: Date; verifiedAt: Date; pickups: StopActuals[]; delivery: StopActuals;
}): { pickup: StopPlan; delivery: StopPlan } {
  if (!["SAV", "HOU"].includes(input.terminal) || !Number.isFinite(input.checkedInAt.getTime()) ||
      !Number.isFinite(input.verifiedAt.getTime()) || input.verifiedAt < input.checkedInAt)
    throw new Error("Invalid check-in or verification time - blocked delivery");
  if (input.pickups.length === 0 || !input.delivery.id)
    throw new Error("Missing pickup or delivery stop - cannot backfill actuals");
  const text = (v: string | null | undefined) => String(v ?? "").trim();
  const needsPickup = input.pickups.some((stop) => !text(stop.actual_arrival) || !text(stop.actual_departure));
  if (needsPickup && input.pickups.length !== 1)
    throw new Error("Multiple pickup stops have incomplete actuals; review them in McLeod before completing delivery");
  let fallbackArrival = "", fallbackDeparture = "";
  if (needsPickup) {
    // Validate before subtracting, so an invalid date cannot roll into a valid one.
    warehouseWallTime(input.receivedDate, 8, 0, input.terminal);
    const previous = new Date(`${input.receivedDate}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const day = previous.toISOString().slice(0, 10);
    fallbackArrival = warehouseWallTime(day, 8, 0, input.terminal);
    fallbackDeparture = warehouseWallTime(day, 8, 5, input.terminal);
  }
  function plan(stop: StopActuals, arrival: string, departure: string): StopPlan {
    if (!stop.id) throw new Error("Missing McLeod stop ID - cannot post actuals");
    const existingArrival = text(stop.actual_arrival), existingDeparture = text(stop.actual_departure);
    return { stopId: stop.id, skipped: Boolean(existingArrival && existingDeparture),
      arrivalDate: existingArrival || arrival, departureDate: existingDeparture || departure,
      generatedArrival: !existingArrival, generatedDeparture: !existingDeparture };
  }
  const pickup = plan(input.pickups[0], fallbackArrival, fallbackDeparture);
  const delivery = plan(input.delivery, formatWarehouseTime(input.checkedInAt, input.terminal),
    formatWarehouseTime(input.verifiedAt, input.terminal));
  const deliveryArrival = actualInstant(delivery.arrivalDate), deliveryDeparture = actualInstant(delivery.departureDate);
  for (const stop of input.pickups) {
    const planned = input.pickups.length === 1 ? pickup : plan(stop, "", "");
    if (actualInstant(planned.arrivalDate) > actualInstant(planned.departureDate) ||
        actualInstant(planned.departureDate) > deliveryArrival || deliveryArrival > deliveryDeparture)
      throw new Error("Pickup and delivery actuals would be out of order. Existing actuals were preserved; review the times in McLeod");
  }
  return { pickup, delivery };
}
