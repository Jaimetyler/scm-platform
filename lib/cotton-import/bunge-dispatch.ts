export type DispatchLine = { row: number; mark: string; salesOrder: string; bales: number; warehouse: string; rtl: string };
export type DispatchOrder = { mark: string; salesOrder: string; bales: number; pickups: DispatchLine[] };
const str = (v: unknown) => String(v ?? "").trim();
export function parseBungeDispatch(rows: readonly (readonly unknown[])[]) {
  const header = rows.findIndex(r => str(r[0]).toUpperCase() === "MARK" && str(r[1]).toUpperCase() === "SO");
  if (header < 0) throw new Error("Bunge Mark/SO header missing");
  const destination = str(rows.find(r => str(r[0]).toUpperCase() === "DESTINATION:")?.[1]);
  if (!destination) throw new Error("Dispatch destination missing");
  const grouped = new Map<string, DispatchOrder>();
  const blocked: { row: number; reason: string }[] = [];
  for (let index = header + 1; index < rows.length; index++) {
    const r = rows[index], mark = str(r[0]), salesOrder = str(r[1]);
    if (!mark || !/^\d{5,}$/.test(salesOrder)) continue;
    const bales = Number(r[4]), warehouse = str(r[9]), rtl = str(r[14]);
    const dateMatch = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2}|\\d{4})$/.exec(rtl);
    const iso = dateMatch ? `${dateMatch[3].length === 2 ? "20" + dateMatch[3] : dateMatch[3]}-${dateMatch[1].padStart(2,"0")}-${dateMatch[2].padStart(2,"0")}` : "";
    const validDate = Boolean(iso) && !Number.isNaN(Date.parse(iso + "T00:00:00Z")) && new Date(iso + "T00:00:00Z").toISOString().slice(0,10) === iso;
    if (!Number.isSafeInteger(bales) || bales <= 0 || !warehouse || !validDate) {
      blocked.push({ row: index + 1, reason: "Missing or invalid bales, warehouse or RTL date" });
      continue;
    }
    const key = salesOrder + "|" + mark.toUpperCase();
    const order = grouped.get(key) ?? { mark, salesOrder, bales: 0, pickups: [] };
    if (order.pickups.length === 2) {
      blocked.push({ row: index + 1, reason: "More than two pickup lines" });
      continue;
    }
    order.pickups.push({ row: index + 1, mark, salesOrder, bales, warehouse, rtl });
    order.bales += bales;
    grouped.set(key, order);
  }
  if (!grouped.size) throw new Error("No dispatch lines found");
  return { destination, orders: [...grouped.values()], blocked };
}
