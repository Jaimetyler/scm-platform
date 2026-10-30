export type InboundExcelRow = {
  receivedDate: string;
  mark: string;
  shipper: string;
  bolBC: string;
  balesUnloaded?: number | null;
  location?: string | null;
  sourceSheet?: string | null;
  source?: "live_checkin";
  checkedInAt?: string | null;
  verifiedAt?: string | null;
  terminal?: "SAV" | "HOU";
};

export type CustomerXrefRow = {
  alias: string;
  canonicalCustomer: string;
  customerId: string;
  customerName: string;
  active: boolean;
};

export type McleodCandidate = {
  orderId: string | number;
  movementId: string | number | null;
  customerId: string;
  customerName?: string | null;
  blnum: string | null;
  consigneeRefNo: string | null;
  originActualArrival: string | null;
  originActualDeparture: string | null;
  destActualArrival: string | null;
  destActualDeparture: string | null;
  schedOriginEarly: string | null;
  schedOriginLate: string | null;
  schedDestEarly: string | null;
  schedDestLate: string | null;
  movementStatus: string | null;
  brokerageStatus: string | null;
  raw?: Record<string, unknown>;
};

export type PreviewResult = {
  row: InboundExcelRow;
  resolvedCustomer?: {
    canonicalCustomer: string;
    customerId: string;
    customerName: string;
  };
  candidateCount: number;
  matched?: McleodCandidate;
  parsedBlnum?: {
    raw: string;
    mark: string;
    count: string;
    unit: string;
  };
  status:
    | "Unknown Customer"
    | "No Match"
    | "Multiple Matches"
    | "Weak Match - Review"
    | "Already Delivered"
    | "Missing Origin Scheduled Date"
    | "Ready to Deliver"
    | "Ready to Deliver with Origin Backfill";
  reason: string;
  proposed?: {
    originActualArrival: string | null;
    originActualDeparture: string | null;
    destActualArrival: string | null;
    destActualDeparture: string | null;
    movementStatus: "d";
    brokerageStatus: "finished";
  };
};
