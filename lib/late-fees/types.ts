export type McleodMovement = {
  status?: string | null;
  brokerage_status?: string | null;
};

export type McleodStop = {
  stop_type?: string | null;
  location_id?: string | number | null;

  sched_arrive_early?: string | null;
  sched_arrive_late?: string | null;

  city_name?: string | null;
  state?: string | null;
};

export type McleodOrderSummary = {
  id?: string | number;
  order_id?: string | number;

  blnum?: string | null;

  revenue_code_id?: string | null;
  customer_id?: string | null;

  doc_cutoff_date?: string | null;
  bill_date?: string | null;

  status?: string | null;

  movement?: McleodMovement | null;
  movements?: McleodMovement[] | null;

  commodity?: string | null;
commodity_id?: string | null;

  stops?: McleodStop[] | null;
};

export type LateFeeRow = {
  orderId: string;

  customerId: string;
  revenueCode: string;

  blnum: string;
  mark: string | null;

  bales: number;

  movementStatus: string;
  brokerageStatus: string;
  orderStatus: string;

  docCutoffDate: string | null;

  lastFreeDate: string | null;
  feeStartDate: string | null;

  anchorDateUsed:
    | "doc_cutoff_date"
    | "so_sched_arrive_late"
    | "so_sched_arrive_early"
    | "none";

  rawDaysLate: number;
  graceDays: number;
  effectiveDaysLate: number;

  lateFee: number;

  policyCode: string | null;
  policyType: string | null;

  avoidableFee: boolean | null;
  policyAmount: number | null;

  puLocationId: string | null;
  puCity: string | null;
  puState: string | null;

  soLocationId: string | null;
  soCity: string | null;
  soState: string | null;
};

export type LateFeeOfficeConfig = {
  office: string;

  revenueCodes: string[];

  excludedMovementStatuses: string[];
  excludedBrokerageStatuses: string[];

  policyMatch: "PU" | "SO";

  graceRule:
    | "ignore_if_doc_cutoff_exists"
    | "always_apply";
};