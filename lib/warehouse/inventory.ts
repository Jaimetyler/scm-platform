export const INVENTORY_STATUSES = ["active", "on_hold", "closed"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const RECEIPT_STATUSES = [
  "not_ready", "pending", "created", "failed", "not_required",
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export type InventoryEditable = {
  currentBales: number;
  allocatedBales: number;
  missingBales: number;
  warehouseLocation: string | null;
  bookingNumber: string | null;
  inventoryStatus: InventoryStatus;
  notes: string | null;
};

function nonNegativeInteger(value: unknown, label: string) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a whole number of zero or more`);
  }
  return number;
}

function cleanOptional(value: unknown, uppercase = false) {
  const text = String(value ?? "").trim();
  return text ? (uppercase ? text.toUpperCase() : text) : null;
}

export function normalizeInventoryUpdate(body: Record<string, unknown>): InventoryEditable {
  const currentBales = nonNegativeInteger(body.currentBales, "Current bales");
  const allocatedBales = nonNegativeInteger(body.allocatedBales, "Allocated bales");
  const missingBales = nonNegativeInteger(body.missingBales, "Missing bales");
  const inventoryStatus = String(body.inventoryStatus ?? "").trim() as InventoryStatus;

  if (allocatedBales > currentBales) {
    throw new Error("Allocated bales cannot exceed current bales");
  }
  if (!INVENTORY_STATUSES.includes(inventoryStatus)) {
    throw new Error("Invalid inventory status");
  }

  return {
    currentBales,
    allocatedBales,
    missingBales,
    warehouseLocation: cleanOptional(body.warehouseLocation, true),
    bookingNumber: cleanOptional(body.bookingNumber, true),
    inventoryStatus,
    notes: cleanOptional(body.notes),
  };
}

export function availableBales(current: number, allocated: number) {
  return Math.max(0, current - allocated);
}

export function safeInventorySearch(value: unknown) {
  return String(value ?? "").trim().replace(/[%_,().]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 80);
}
