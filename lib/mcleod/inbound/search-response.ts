// After a successful HTTP response, this McLeod orders/search endpoint returns
// JSON null when a reference field has no matches (confirmed against a known BL).
// Unknown objects and nested null wrappers still mean an incomplete search.
export function extractSearchOrders(payload: unknown, depth = 0): unknown[] | null {
  if (payload === null && depth === 0) return [];
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object" || depth > 2) return null;

  const response = payload as Record<string, unknown>;
  for (const key of ["items", "results", "orders", "rows", "data", "row", "RowOrders"]) {
    if (Array.isArray(response[key])) return response[key] as unknown[];
  }

  for (const key of ["data", "response", "result"]) {
    if (response[key] && typeof response[key] === "object") {
      const nested = extractSearchOrders(response[key], depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}
