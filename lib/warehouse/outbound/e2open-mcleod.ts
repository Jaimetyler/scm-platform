import { imagingClient } from "@/lib/dray-bols/imaging";
import { vendor } from "@/lib/dray/server";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";

const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase();
const limit = 20;

export async function checkLdcOrder(booking: string, container: string, mark: string, shippingOrder: string) {
  const result = { container, mark, orderId: null as string | null, status: "", documentTypes: [] as { id: string; description: string; existing: number }[] };
  if (!mark || !shippingOrder) return { ...result, status: "Mark or shipping order is missing" };
  const { read } = vendor(true);
  const query = new URLSearchParams({ "orders.blnum": mark, recordLength: String(limit) });
  try {
    const rows = extractSearchOrders(await read("/orders/search?" + query)) as { id?: unknown }[] | null;
    if (!rows || rows.length >= limit) return { ...result, status: "Order search needs manual review" };
    const ids = [...new Set(rows.map(row => String(row?.id ?? "")))];
    if (ids.some(id => !/^\d{6,7}$/.test(id))) return { ...result, status: "Order search returned an unrecognized order number" };
    const matches: string[] = [];
    const orders = await Promise.all(ids.map(id => read("/orders/" + id)));
    for (const [index, order] of orders.entries()) {
      const id = ids[index];
      if (String(order?.id) !== id) return { ...result, status: "Order details could not be verified" };
      if (normalize(order.blnum) === normalize(mark) && normalize(order.consignee_refno) === container &&
          normalize(order.booking_no_sucm) === normalize(booking) && normalize(order.ordered_by) === normalize(shippingOrder) &&
          ["ALLELOTN", "LDCACOTN"].includes(normalize(order.customer_id))) matches.push(id);
    }
    if (matches.length !== 1) return { ...result, status: matches.length ? "Multiple orders match" : "No verified order match" };
    const orderId = matches[0];
    try {
      const imaging = imagingClient();
      const [types, images] = await Promise.all([imaging.types(orderId), imaging.images(orderId)]);
      return { ...result, orderId, status: "Verified order", documentTypes: types.map(type => ({
        ...type, existing: images.filter(image => image.documentTypeId === type.id).length,
      })) };
    } catch {
      return { ...result, orderId, status: "Order verified; imaging information unavailable" };
    }
  } catch {
    return { ...result, status: "McLeod lookup unavailable" };
  }
}
