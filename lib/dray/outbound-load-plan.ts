export const outboundDrayMarkets = {
  DAL: {
    revenueCode: "DDRAY",
    pickupLocations: { "875260": "SCMDDETX", "843001": "SCMDDATX" } as Readonly<Record<string, string>>,
  },
} as const;

export function planOutboundDrayLoads(bookId: string, count: number | null, pickup: string | null, delivery: string | null) {
  const reference = bookId.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(reference)) throw Error("Enter a valid Book ID.");
  if (count == null || !Number.isSafeInteger(count) || count < 1 || count > 500)
    throw Error("Enter a container count from 1 to 500.");
  if (!pickup || !delivery) throw Error("Resolve the pickup warehouse and return location.");
  return Array.from({ length: count }, (_, index) => ({
    sequence: index + 1,
    originalBlnum: reference + "-" + (index + 1),
    pickup,
    delivery,
  }));
}
