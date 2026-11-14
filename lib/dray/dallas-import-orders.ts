import { dateStamp } from "../ecotton/mcleod.ts";
import type { planOutboundDrayLoads } from "./outbound-load-plan.ts";

function dallasDateTime(value: string) {
  const time = value.slice(11, 19).replace(/:/g, "").padEnd(6, "0");
  return dateStamp(value.slice(0, 10), "America/Chicago").replace("000000", time);
}

export function matchesDallasImportDate(actual: unknown, expected: string) {
  const value = String(actual ?? "").trim();
  if (value === expected) return true;
  const wallTime = (date: string) => date.slice(0, 19).replace(/[-:T ]/g, "").padEnd(14, "0");
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/.test(value))
    return wallTime(value) === expected.slice(0, 14);
  const iso = (date: string) => date.replace(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/,
    "$1-$2-$3T$4:$5:$6$7",
  );
  return Date.parse(iso(value)) === Date.parse(iso(expected));
}

export function dallasBookingFields(booking: string, erd: string, cutoff: string,
  details: { bookId: string; steamshipLine: string | null; boltSealsRequired: boolean; docCutoff?: string | null }) {
  const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const ssl = details.steamshipLine?.trim() ?? "";
  const carrier = /^orient overseas container line(?: limited)?$/i.test(ssl) ? "OOCL" : ssl;
  const planningComment = `ID${details.bookId}: ${carrier ? carrier + " " : ""}Bkg# ${booking} - ERD ${shortDate(erd)} - C/O ${shortDate(cutoff)}${details.boltSealsRequired ? " *Bolt Seals Required*" : ""}`;
  return {
    booking_no_sucm: booking, planning_comment: planningComment, cutoff_date: dallasDateTime(cutoff),
    ...(details.docCutoff ? { doc_cutoff_date: dallasDateTime(details.docCutoff) } : {}),
    ...(carrier ? { ssl_sucm: carrier } : {}),
  };
}

export function dallasImportPayload(load: ReturnType<typeof planOutboundDrayLoads>[number],
  booking: string, customer: string, erd: string, cutoff: string, details: { bookId: string; steamshipLine: string | null; boltSealsRequired: boolean; docCutoff?: string | null }) {
  return {
    __type: "orders", company_id: "TMS", status: "A", customer_id: customer, revenue_code_id: "DDRAY",
    order_type_id: "FSCD", commodity_id: "COTTON", equipment_type_id: "C", order_mode: "T", collection_method: "T",
    blnum: load.originalBlnum, ...dallasBookingFields(booking, erd, cutoff, details),
    stops: [{ stop_type: "PU", location_id: load.pickup }, { stop_type: "SO", location_id: load.delivery }].map((stop, index) => ({
      ...stop, __type: "stop", __name: "stops", company_id: "TMS", status: "A", order_sequence: index + 1,
      sched_arrive_early: dateStamp(erd, "America/Chicago"),
      sched_arrive_late: dallasDateTime(cutoff),
    })),
  };
}
