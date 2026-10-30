import { parseBlnum, normalizeKey } from "./utils";
import { McleodCandidate } from "./types";

function getBaseUrl() {
  const baseUrl = process.env.MCLEOD_BASE_URL;
  if (!baseUrl) throw new Error("Missing MCLEOD_BASE_URL");
  return baseUrl.replace(/\/+$/, "");
}

function getHeaders() {
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!token) throw new Error("Missing MCLEOD_AUTH_TOKEN");

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

function toArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.orders)) return data.orders;
  return [];
}

function mapOrderToCandidate(order: any): McleodCandidate {
  const stops = order.stops || [];

  const origin = stops.find((s: any) => s.stop_type === "PU");
  const dest = stops.find((s: any) => s.stop_type === "SO");

  return {
    orderId: order.id,
    movementId: order.curr_movement_id,

    customerId: order.customer_id,
    customerName: order.customer?.name || null,

    blnum: order.blnum,
    consigneeRefNo: order.consignee_refno,

    originActualArrival: origin?.actual_arrival || null,
    originActualDeparture: origin?.actual_departure || null,

    destActualArrival: dest?.actual_arrival || null,
    destActualDeparture: dest?.actual_departure || null,

    schedOriginEarly: origin?.sched_arrive_early || null,
    schedOriginLate: origin?.sched_arrive_late || null,

    schedDestEarly: dest?.sched_arrive_early || null,
    schedDestLate: dest?.sched_arrive_late || null,

    movementStatus: order.status,
    brokerageStatus: null,
    raw: order,
  };
}

export function scoreCandidate(
  candidate: McleodCandidate,
  excelMark: string,
  excelBolBC: string
) {
  const parsed = parseBlnum(candidate.blnum);

  const candidateConsigneeRef = normalizeKey(candidate.consigneeRefNo);
  const parsedMark = normalizeKey(parsed.mark);
  const parsedCount = normalizeKey(parsed.count);

  const normalizedExcelMark = normalizeKey(excelMark);
  const normalizedExcelBolBC = normalizeKey(excelBolBC);

  const markMatch =
    candidateConsigneeRef === normalizedExcelMark ||
    parsedMark === normalizedExcelMark ||
    normalizeKey(candidate.blnum).includes(normalizedExcelMark);

  const baleCountMatch =
    !!normalizedExcelBolBC &&
    !!parsedCount &&
    parsedCount === normalizedExcelBolBC;

  const strong = markMatch && baleCountMatch;

  return {
    parsed,
    markMatch,
    baleCountMatch,
    strong,
  };
}

async function runSearch(url: string) {
  console.log("SEARCH URL", url);

  const res = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`McLeod API error ${res.status} ${body}`);
  }

  const text = await res.text();
  const data = text?.trim() ? JSON.parse(text) : [];
  const orders = toArray(data);

  console.log("SEARCH COUNT", orders.length);

  return orders;
}

export async function findCandidatesByCustomer(
  mark: string,
  customerId: string | string[]
): Promise<McleodCandidate[]> {
  const baseUrl = getBaseUrl();
  const normalizedMark = normalizeKey(mark);

  const customerIds = Array.isArray(customerId) ? customerId : [customerId];

  const searchUrls = [
    `${baseUrl}/orders/search?${new URLSearchParams({
      consignee_refno: normalizedMark,
    }).toString()}`,
    `${baseUrl}/orders/search?${new URLSearchParams({
      blnum: normalizedMark,
    }).toString()}`,
  ];

  const seen = new Map<string, any>();

  for (const url of searchUrls) {
    try {
      const orders = await runSearch(url);

      for (const order of orders) {
        const id = String(order.id ?? "");
        if (id && !seen.has(id)) {
          seen.set(id, order);
        }
      }
    } catch (error) {
      console.log("SEARCH ERROR", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const orders = Array.from(seen.values());

  const filteredPool = orders.filter((o: any) => {
    const commodityValue = normalizeKey(
      o.commodity_id ??
        o.commodityId ??
        o.commodity ??
        o.commodity_description ??
        o.commodity_desc
    );

    const normalizedConsigneeRef = normalizeKey(o.consignee_refno);
    const normalizedBlnum = normalizeKey(o.blnum);

    const customerMatch = customerIds.includes(o.customer_id);
    const revenueMatch = o.revenue_code_id === "MAIN";
    const commodityMatch = commodityValue === "COTTON";
    const statusMatch = ["A", "P", "D"].includes(o.status);

    const markHit =
      normalizedConsigneeRef === normalizedMark ||
      normalizedBlnum.includes(normalizedMark) ||
      normalizeKey(parseBlnum(o.blnum).mark) === normalizedMark;

    console.log("FILTER CHECK", {
      orderId: o.id,
      customer_id: o.customer_id,
      allowedCustomers: customerIds,
      revenue_code_id: o.revenue_code_id,
      commodity: commodityValue,
      status: o.status,
      consignee_refno: o.consignee_refno,
      blnum: o.blnum,
      customerMatch,
      revenueMatch,
      commodityMatch,
      statusMatch,
      markHit,
    });

    return (
      markHit &&
      customerMatch &&
      revenueMatch &&
      commodityMatch &&
      statusMatch
    );
  });

  console.log("FILTERED POOL COUNT", filteredPool.length);

  if (filteredPool.length > 0) {
    return filteredPool.map(mapOrderToCandidate);
  }

  const fallbackPool = orders.filter((o: any) => {
    const normalizedConsigneeRef = normalizeKey(o.consignee_refno);
    const normalizedBlnum = normalizeKey(o.blnum);

    const customerMatch = customerIds.includes(o.customer_id);
    const markHit =
      normalizedConsigneeRef === normalizedMark ||
      normalizedBlnum.includes(normalizedMark) ||
      normalizeKey(parseBlnum(o.blnum).mark) === normalizedMark;

    return customerMatch && markHit;
  });

  console.log("FALLBACK POOL COUNT", fallbackPool.length);

  return fallbackPool.map(mapOrderToCandidate);
}