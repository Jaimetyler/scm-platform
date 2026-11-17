import { outboundSteamshipLine } from "../warehouse/outbound/booking-identifiers.ts";
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
  if (!Number.isFinite(nominal)) throw Error("Enter a valid Dallas date and time before syncing.");
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

export function matchesDallasMcLeodDetailDate(actual: unknown, expected: string, dateOnly = false) {
  const value = String(actual ?? "").trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})?$/;
  const toIso = (date: string) => date.replace(compact, "$1-$2-$3T$4:$5:$6$7").replace(" ", "T");
  const iso = toIso(value);
  const expectedIso = toIso(expected.trim());
  const expectedDay = expectedIso.slice(0, 10);
  if (dateOnly && /^\d{8}$/.test(value)) return value === expectedDay.replaceAll("-", "");
  if (dateOnly && matchesDallasImportDate(iso.slice(0, 10), expectedDay)) return true;
  if (matchesDallasImportDate(value, expected)) return true;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso)) return false;
  const observed = Date.parse(iso);
  if (!Number.isFinite(observed)) return false;
  if (dateOnly) {
    const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(observed);
    return localDate === expectedDay;
  }
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(expectedIso))
    return observed === Date.parse(expectedIso);
  if (!matchesDallasImportDate(expectedIso, expectedIso)) return false;
  try {
    return observed === Date.parse(toIso(dallasMcLeodDetailDate(expectedIso)));
  } catch {
    return false;
  }
}

export function withRequiredCottonBoltSeals(comment: string) {
  const text = comment.trim();
  return /\bbolt seals? required\b/i.test(text) ? text : [text, "*Bolt Seals Required*"].filter(Boolean).join(" ");
}

export function dallasBookingFields(booking: string, erd: string, cutoff: string,
  details: { bookId: string; steamshipLine: string | null; docCutoff?: string | null }) {
  const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const ssl = outboundSteamshipLine(details.steamshipLine, booking);
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
