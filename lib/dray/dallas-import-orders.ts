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
      sched_arrive_early: dallasDateTime(erd),
      sched_arrive_late: dallasDateTime(cutoff),
    })),
  };
}
