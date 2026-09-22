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
