import { dateStamp } from "../../ecotton/mcleod.ts";
import { dallasOrderBookingReferences } from "./planning-info.ts";

export const scmIntermodalPay = { BNSFHATX: 39293, UNIOWITX: 20085 } as const;
const haslet = "BNSFHATX";
const pickup = "SCMDDETX";
const customer = "OLAMRITX";
const carrier = "SCMIRIGA";
const key = (value: unknown) => String(value ?? "").trim().toUpperCase();
const cents = (value: unknown) => value == null || String(value).trim() === "" ? NaN : Math.round(Number(value) * 100);
const chassis = {
  __type: "other_charge", __name: "otherCharges", company_id: "TMS", charge_id: "DSCM", descr: "DAL Chassis Charges",
  units: 1, rate: 35, amount: 35, incl_in_freight: "N", bill_type: "F", calc_method: "F",
};

export type DallasPilotPlan = { booking: string; container: string; bol: string; orderedBy: string; early: string; late: string };

export function matchesDallasPilot(order: any, plan: DallasPilotPlan) {
  const refs = dallasOrderBookingReferences(order);
  return key(order.customer_id) === customer && key(order.revenue_code_id) === "DDRAY" &&
    key(order.consignee_refno) === plan.container && refs.size === 1 && refs.has(plan.booking) &&
    Array.isArray(order.stops) && order.stops.length === 2 &&
    order.stops.some(stop => key(stop.stop_type) === "PU" && key(stop.location_id) === pickup) &&
    order.stops.some(stop => key(stop.stop_type) === "SO" && key(stop.location_id) === haslet);
}

export function createDallasPilotPayload(plan: DallasPilotPlan) {
  if (!plan.bol || !plan.orderedBy) throw Error("Enter the BOL and Ordered by for the new order.");
  for (const day of [plan.early, plan.late]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day) throw Error("Enter valid schedule dates.");
  }
  if (plan.early > plan.late) throw Error("The schedule end must be on or after the start.");
  return {
    __type: "orders", company_id: "TMS", status: "A", customer_id: customer, revenue_code_id: "DDRAY", order_type_id: "FSCD",
    commodity_id: "COTTON", equipment_type_id: "C", order_mode: "T", collection_method: "T",
    blnum: plan.bol, ordered_by: plan.orderedBy, consignee_refno: plan.container, booking_no_sucm: plan.booking,
    planning_comment: `BKG: ${plan.booking}`, rate_type: "F", rate_units: 1, rate: 545, total_charge: 580,
    stops: [{ stop_type: "PU", location_id: pickup }, { stop_type: "SO", location_id: haslet }].map((stop, index) => ({
      ...stop, __type: "stop", __name: "stops", company_id: "TMS", status: "A", order_sequence: index + 1,
      sched_arrive_early: dateStamp(plan.early, "America/Chicago"), sched_arrive_late: dateStamp(plan.late, "America/Chicago"),
    })),
    movements: [{ __name: "movements", ...movementPay() }],
  };
}

function movementPay() {
  const pay = scmIntermodalPay.BNSFHATX / 100;
  return { __type: "movement", company_id: "TMS", override_payee_id: carrier, override_type: "F", override_units: 1,
    override_paye_rate: pay, override_pay_rate: pay, override_pay_amt: pay };
}

export function reviewDallasPilotOrder(order: any, plan: DallasPilotPlan) {
  if (!matchesDallasPilot(order, plan) || !/^[A-Z0-9_-]+$/i.test(String(order.id ?? "")) ||
    key(order.status) !== "A" || !["FLAT", "FSCD"].includes(key(order.order_type_id)) ||
    order.stops.some(stop => key(stop.status) !== "A" || stop.actual_arrival || stop.actual_departure)) {
    throw Error("The order identity or available status could not be verified.");
  }
  const movement = order.movements?.length === 1 ? order.movements[0] : null;
  if (!movement || !/^[A-Z0-9_-]+$/i.test(String(movement.id ?? "")) || String(order.curr_movement_id) !== String(movement.id) ||
    (movement.status && key(movement.status) !== "A") ||
    [movement.override_payee_id, movement.carrier_id, movement.vendor_id].some(id => key(id) && key(id) !== carrier)) {
    throw Error("Review the current movement and payee in McLeod.");
  }
  const charges = order.otherCharges ?? order.other_charges;
  const correctChassis = (charge: any) => key(charge.charge_id) === "DSCM" &&
    Number(charge.units) === 1 && cents(charge.rate) === 3500 && cents(charge.amount) === 3500 && key(charge.incl_in_freight) === "N";
  if (!Array.isArray(charges) || charges.length > 1 || charges.some(charge => !correctChassis(charge))) {
    throw Error("Review the existing customer charges in McLeod. The pilot can add one standard DSCM charge.");
  }
  const pay = movementPay();
  return {
    before: { orderId: String(order.id), rate: order.rate, total: order.total_charge, chassis: charges.length ? 35 : 0,
      movementId: String(movement.id), payee: movement.override_payee_id ?? null, pay: movement.override_pay_amt ?? null,
      payMethod: movement.override_type ?? null, payUnits: movement.override_units ?? null,
      payRate: movement.override_pay_rate ?? null, payeeRate: movement.override_paye_rate ?? null,
      rateType: order.rate_type, rateUnits: order.rate_units },
    billing: charges.length === 1 && cents(order.rate) === 54500 && cents(order.total_charge) === 58000 &&
      key(order.rate_type) === "F" && Number(order.rate_units) === 1 ? null : {
      __type: "orders", company_id: "TMS", id: String(order.id), rate_type: "F", rate_units: 1, rate: 545, total_charge: 580,
      ...(charges.length ? {} : { otherCharges: [chassis] }),
    },
    movement: key(movement.override_payee_id) === carrier && key(movement.override_type) === "F" &&
      Number(movement.override_units) === 1 && [movement.override_paye_rate, movement.override_pay_rate, movement.override_pay_amt]
        .every(value => cents(value) === scmIntermodalPay.BNSFHATX) ? null : { ...pay, id: String(movement.id) },
  };
}
