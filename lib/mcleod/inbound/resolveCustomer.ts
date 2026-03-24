import { CUSTOMER_XREF } from "./xref";
import { normalizeKey } from "./utils";

export function resolveCustomer(shipper: string | null | undefined) {
  const key = normalizeKey(shipper);

  const row = CUSTOMER_XREF.find(
    (x) => x.active && normalizeKey(x.alias) === key
  );

  if (!row) return null;

  return {
    canonicalCustomer: row.canonicalCustomer,
    customerId: row.customerId,
    customerName: row.customerName,
  };
}