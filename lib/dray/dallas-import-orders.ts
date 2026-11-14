import { dateStamp } from "../ecotton/mcleod.ts";
import type { planOutboundDrayLoads } from "./outbound-load-plan.ts";

export function dallasImportPayload(load: ReturnType<typeof planOutboundDrayLoads>[number],
  booking: string, customer: string, erd: string, cutoff: string) {
  return {
    __type: "orders", company_id: "TMS", status: "A", customer_id: customer, revenue_code_id: "DDRAY",
    order_type_id: "FLAT", commodity_id: "COTTON", equipment_type_id: "C", order_mode: "T", collection_method: "T",
    blnum: load.originalBlnum, booking_no_sucm: booking, planning_comment: `BKG: ${booking}`,
    stops: [{ stop_type: "PU", location_id: load.pickup }, { stop_type: "SO", location_id: load.delivery }].map((stop, index) => ({
      ...stop, __type: "stop", __name: "stops", company_id: "TMS", status: "A", order_sequence: index + 1,
      sched_arrive_early: dateStamp(erd, "America/Chicago"),
      sched_arrive_late: dateStamp(cutoff.slice(0, 10), "America/Chicago").replace("000000", (cutoff.slice(11, 16).replace(":", "") || "0000") + "00"),
    })),
  };
}
