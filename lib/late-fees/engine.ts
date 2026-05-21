import {
  calculateLateFee,
  getPolicyMap,
  type LateFeePolicy,
} from "@/lib/lateFeePolicies";

import type {
  LateFeeOfficeConfig,
  LateFeeRow,
  McleodOrderSummary,
} from "./types";

import {
  addDays,
  diffDaysLate,
  formatDateFromDate,
  formatDateOnly,
  normalizeDateInput,
  parseBales,
  parseMark,
  round2,
} from "@/lib/late-fees/utils";

import {
  getBrokerageStatus,
  getMovementStatus,
  getOrderId,
  getStop,
} from "./orderHelpers";

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getAnchorDate(
  order: McleodOrderSummary,
  config: LateFeeOfficeConfig
): {
  date: Date | null;
  source: LateFeeRow["anchorDateUsed"];
} {
  const cutoff = normalizeDateInput(order.doc_cutoff_date);

  if (config.office === "Savannah") {
    if (cutoff) return { date: cutoff, source: "doc_cutoff_date" };
    return { date: null, source: "none" };
  }

  if (cutoff) return { date: cutoff, source: "doc_cutoff_date" };

  const so = getStop(order, "SO");

  const late = normalizeDateInput(so?.sched_arrive_late ?? null);
  if (late) return { date: late, source: "so_sched_arrive_late" };

  const early = normalizeDateInput(so?.sched_arrive_early ?? null);
  if (early) return { date: early, source: "so_sched_arrive_early" };

  return { date: null, source: "none" };
}

export function getPolicyLocationId(
  order: McleodOrderSummary,
  config: LateFeeOfficeConfig
): string | null {
  const policyStop = getStop(order, config.policyMatch);

  if (policyStop?.location_id === undefined || policyStop?.location_id === null) {
    return null;
  }

  return String(policyStop.location_id).trim();
}

export function getKeepReason(
  order: McleodOrderSummary,
  config: LateFeeOfficeConfig
): {
  keep: boolean;
  reason: string;
} {
  const revenueCode = safeString(order.revenue_code_id).toUpperCase();

  if (!config.revenueCodes.includes(revenueCode)) {
    return {
      keep: false,
      reason: `revenue_code_id was ${revenueCode || "blank"}`,
    };
  }

  const movementStatus = getMovementStatus(order);
  if (
    movementStatus &&
    config.excludedMovementStatuses.includes(movementStatus)
  ) {
    return {
      keep: false,
      reason: `excluded movement status ${movementStatus}`,
    };
  }

  const brokerageStatus = getBrokerageStatus(order);
  if (
    brokerageStatus &&
    config.excludedBrokerageStatuses.includes(brokerageStatus)
  ) {
    return {
      keep: false,
      reason: `excluded brokerage status ${brokerageStatus}`,
    };
  }

  const billDate = safeString(order.bill_date);
  if (billDate) {
    return {
      keep: false,
      reason: `bill_date present ${billDate}`,
    };
  }

  const blnum = safeString(order.blnum);
  if (!blnum) {
    return {
      keep: false,
      reason: "missing blnum",
    };
  }

  const bales = parseBales(blnum);
  if (!bales || bales <= 0) {
    return {
      keep: false,
      reason: `could not parse bales from ${blnum}`,
    };
  }

  return { keep: true, reason: "kept" };
}

export function shouldKeepOrder(
  order: McleodOrderSummary,
  config: LateFeeOfficeConfig
): boolean {
  return getKeepReason(order, config).keep;
}

export function mapOrderToLateFeeRow(
  order: McleodOrderSummary,
  config: LateFeeOfficeConfig
): {
  row: LateFeeRow;
  hasPolicy: boolean;
} {
  const policyMap = getPolicyMap();

  const orderId = getOrderId(order);
  const revenueCode = safeString(order.revenue_code_id).toUpperCase();
  const blnum = safeString(order.blnum);
  const bales = parseBales(blnum);

  const pu = getStop(order, "PU");
  const so = getStop(order, "SO");

  const anchor = getAnchorDate(order, config);
  const rawDaysLate = diffDaysLate(anchor.date);

  const policyLocationId = getPolicyLocationId(order, config);

  const policy: LateFeePolicy | undefined = policyLocationId
    ? policyMap.get(policyLocationId)
    : undefined;

  const graceDays =
    config.graceRule === "ignore_if_doc_cutoff_exists" &&
    anchor.source === "doc_cutoff_date"
      ? 0
      : Number(policy?.late_load_grace_days ?? 0);

  const effectiveDaysLate = Math.max(0, rawDaysLate - graceDays);
  const lateFee = round2(calculateLateFee(policy, bales, effectiveDaysLate));

  const lastFreeAnchorDate =
    anchor.source === "doc_cutoff_date"
      ? normalizeDateInput(order.doc_cutoff_date)
      : anchor.source === "so_sched_arrive_late"
        ? normalizeDateInput(so?.sched_arrive_late ?? null)
        : anchor.source === "so_sched_arrive_early"
          ? normalizeDateInput(so?.sched_arrive_early ?? null)
          : null;

  const lastFreeDate = formatDateFromDate(lastFreeAnchorDate);
  const feeStartDate =
    effectiveDaysLate > 0
      ? formatDateFromDate(addDays(lastFreeAnchorDate, 1))
      : null;

  const row: LateFeeRow = {
    orderId,
    customerId: safeString(order.customer_id),
    revenueCode,
    blnum,
    mark: parseMark(blnum),
    bales,

    movementStatus: getMovementStatus(order),
    brokerageStatus: getBrokerageStatus(order),
    orderStatus: safeString(order.status).toUpperCase(),

    docCutoffDate: formatDateOnly(order.doc_cutoff_date),
    lastFreeDate,
    feeStartDate,
    anchorDateUsed: anchor.source,

    rawDaysLate,
    graceDays,
    effectiveDaysLate,
    lateFee,

    policyCode: policyLocationId,
    policyType: policy?.fee_type ?? null,
    avoidableFee:
      typeof policy?.avoidable_fee === "boolean" ? policy.avoidable_fee : null,
    policyAmount: typeof policy?.amount === "number" ? policy.amount : null,

    puLocationId:
      pu?.location_id !== undefined && pu?.location_id !== null
        ? String(pu.location_id).trim()
        : null,
    puCity: safeString(pu?.city_name),
    puState: safeString(pu?.state),

    soLocationId:
      so?.location_id !== undefined && so?.location_id !== null
        ? String(so.location_id).trim()
        : null,
    soCity: safeString(so?.city_name),
    soState: safeString(so?.state),
  };

  return {
    row,
    hasPolicy: !!policy,
  };
}

export function buildKeepDebug(
  orders: McleodOrderSummary[],
  config: LateFeeOfficeConfig
) {
  return orders.map((o) => ({
    orderId: getOrderId(o),
    revenueCode: safeString(o.revenue_code_id).toUpperCase(),
    movementStatus: getMovementStatus(o),
    brokerageStatus: getBrokerageStatus(o),
    billDate: safeString(o.bill_date),
    blnum: safeString(o.blnum),
    parsedBales: parseBales(safeString(o.blnum)),
    reason: getKeepReason(o, config).reason,
  }));
}