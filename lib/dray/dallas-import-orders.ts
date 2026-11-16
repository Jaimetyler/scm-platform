import { dallasFuelCode } from "./dallas-fuel.ts";
import type { planOutboundDrayLoads } from "./outbound-load-plan.ts";

// McLeod accepts local wall time for appointment fields, as in the cotton inbound importer.
function dallasDateTime(value: string) {
  const local = value.replace(" ", "T").slice(0, 19);
  if (local.length === 10) return `${local}T00:00:00`;
  return local.length === 16 ? `${local}:00` : local;
}

export function stagedDallasLocalTime(value: string) {
  return value.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})[+-]\d{4}$/, "$1-$2-$3T$4:$5:$6");
}

export function dallasMcLeodDetailDate(value: string) {
  const local = dallasDateTime(value);
  const nominal = Date.parse(`${local}Z`);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" });
  const offsetAt = (instant: number) => Number(formatter.formatToParts(new Date(instant))
    .find(part => part.type === "timeZoneName")?.value.replace("GMT", ""));
  const offset = offsetAt(nominal - offsetAt(nominal) * 3_600_000);
  if (!Number.isFinite(offset) || offset !== offsetAt(nominal - offset * 3_600_000))
    throw Error("The Dallas cutoff time does not exist in local time.");
  return `${local.replace(/[-:T]/g, "")}${offset < 0 ? "-" : "+"}${String(Math.abs(offset)).padStart(2, "0")}00`;
}

export function matchesDallasImportDate(actual: unknown, expected: string) {
  const value = String(actual ?? "").trim();
  // Compact McLeod timestamps carry the displayed wall time before the offset.
  const wallTime = (date: string) => {
    if (/^\d{14}(?:[+-]\d{4})?$/.test(date)) return date.slice(0, 14);
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(date))
      return dallasDateTime(date.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "")).replace(/[-:T]/g, "");
    return null;
  };
  const observed = wallTime(value);
  return observed !== null && observed === wallTime(expected);
}

export function withRequiredCottonBoltSeals(comment: string) {
  const text = comment.trim();
  return /\bbolt seals? required\b/i.test(text) ? text : [text, "*Bolt Seals Required*"].filter(Boolean).join(" ");
}

export function dallasBookingFields(booking: string, erd: string, cutoff: string,
  details: { bookId: string; steamshipLine: string | null; docCutoff?: string | null }) {
  const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const ssl = details.steamshipLine?.trim() ?? "";
  const carrier = /^orient overseas container line(?: limited)?$/i.test(ssl) ? "OOCL" : ssl;
  const planningComment = withRequiredCottonBoltSeals(`ID${details.bookId}: ${carrier ? carrier + " " : ""}Bkg# ${booking} - ERD ${shortDate(erd)} - C/O ${shortDate(cutoff)}`);
  return {
    booking_no_sucm: booking, planning_comment: planningComment, cutoff_date: dallasDateTime(cutoff),
    ...(details.docCutoff ? { doc_cutoff_date: dallasDateTime(details.docCutoff) } : {}),
    ...(carrier ? { ssl_sucm: carrier } : {}),
  };
}

export function dallasImportPayload(load: ReturnType<typeof planOutboundDrayLoads>[number],
  booking: string, customer: string, erd: string, cutoff: string, details: { bookId: string; steamshipLine: string | null; docCutoff?: string | null }) {
  return {
    __type: "orders", company_id: "TMS", status: "A", customer_id: customer, revenue_code_id: "DDRAY",
    order_type_id: dallasFuelCode, commodity_id: "COTTON", equipment_type_id: "C", order_mode: "T", collection_method: "T",
    blnum: load.originalBlnum, ...dallasBookingFields(booking, erd, cutoff, details),
    stops: [{ stop_type: "PU", location_id: load.pickup }, { stop_type: "SO", location_id: load.delivery }].map((stop, index) => ({
      ...stop, __type: "stop", __name: "stops", company_id: "TMS", status: "A", order_sequence: index + 1,
      sched_arrive_early: dallasDateTime(erd),
      sched_arrive_late: dallasDateTime(cutoff),
    })),
  };
}
