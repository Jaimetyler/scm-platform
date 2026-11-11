import { imagingClient } from "@/lib/dray-bols/imaging";
import { vendor } from "@/lib/dray/server";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";

const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase();
const limit = 20;

export async function findLdcOrder(booking: string, container: string, mark: string, shippingOrder: string) {
  const result = { container, mark, orderId: null as string | null, movementId: null as string | null, status: "" };
  if (!mark || !shippingOrder) return { ...result, status: "Mark or shipping order is missing" };
  const { read } = vendor(true);
  const query = new URLSearchParams({ "orders.blnum": mark, recordLength: String(limit) });
  try {
    const rows = extractSearchOrders(await read("/orders/search?" + query)) as { id?: unknown }[] | null;
    if (!rows || rows.length >= limit) return { ...result, status: "Order search needs manual review" };
    const ids = [...new Set(rows.map(row => String(row?.id ?? "")))];
    if (ids.some(id => !/^\d{6,7}$/.test(id))) return { ...result, status: "Order search returned an unrecognized order number" };
    const matches: { orderId: string; movementId: string | null }[] = [];
    const orders = await Promise.all(ids.map(id => read("/orders/" + id)));
    for (const [index, order] of orders.entries()) {
      const id = ids[index];
      if (String(order?.id) !== id) return { ...result, status: "Order details could not be verified" };
      if (normalize(order.blnum) === normalize(mark) && normalize(order.consignee_refno) === container &&
          normalize(order.booking_no_sucm) === normalize(booking) && normalize(order.ordered_by) === normalize(shippingOrder) &&
          ["ALLELOTN", "LDCACOTN"].includes(normalize(order.customer_id))) {
        const linked = Array.isArray(order.movements) ? order.movements.map(movement => String(movement?.id ?? "").trim()) : [];
        const current = String(order.curr_movement_id ?? "").trim();
        const movement = current && (!linked.length || linked.includes(current)) ? current : !current && linked.length === 1 ? linked[0] : "";
        matches.push({ orderId: id, movementId: /^[A-Za-z0-9_-]{1,60}$/.test(movement) ? movement : null });
      }
    }
    if (matches.length !== 1) return { ...result, status: matches.length ? "Multiple orders match" : "No verified order match" };
    return { ...result, ...matches[0], status: "Verified order" };
  } catch {
    return { ...result, status: "McLeod lookup unavailable" };
  }
}

export async function checkLdcOrder(booking: string, container: string, mark: string, shippingOrder: string) {
  const result = await findLdcOrder(booking, container, mark, shippingOrder);
  const empty = { ...result, documentTypes: [], existingImages: [], movementImagesAvailable: false };
  if (!result.orderId) return empty;
  const imaging = imagingClient();
  const [types, images, movementImages] = await Promise.allSettled([
    imaging.types(result.orderId), imaging.images(result.orderId),
    result.movementId ? imaging.movementImages(result.movementId) : Promise.resolve(null),
  ]);
  return {
    ...result,
    status: images.status === "fulfilled" ? result.status : "Order verified; existing images unavailable",
    documentTypes: types.status === "fulfilled" ? types.value : [],
    movementImagesAvailable: movementImages.status === "fulfilled" && movementImages.value !== null,
    existingImages: [
      ...(images.status === "fulfilled" ? images.value.map(image => ({ image, scope: "Order" })) : []),
      ...(movementImages.status === "fulfilled" && movementImages.value ? movementImages.value.map(image => ({ image, scope: "Movement" })) : []),
    ].map(({ image, scope }) => ({
      id: image.id, type: image.documentTypeId, description: String(image.descr ?? ""), scanDate: String(image.scanDate ?? ""), scope,
    })),
  };
}
