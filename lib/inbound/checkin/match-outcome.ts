export function isOutsideCarrierNoMatch(preview: {
  status?: string;
  matchedOrderId?: string | null;
  reason?: string;
} | null | undefined): boolean {
  return preview?.status === "No Match" && !preview.matchedOrderId &&
    Boolean(preview.reason?.startsWith("No matches found anywhere for mark "));
}

export function expectedCustomerId(
  preview: { resolvedCustomer?: { customerId?: string } } | null | undefined,
  fallback: string
): string {
  return String(preview?.resolvedCustomer?.customerId || fallback).trim().toUpperCase();
}
