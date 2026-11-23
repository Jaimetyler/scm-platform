import { dispatchDate, type PickupLine } from "./preview";

export const STAPL_CUSTOMER = "STAPGRMS";

export function parseStaplRows(rows: unknown[][], sheet: string) {
  const text = (value: unknown) => String(value ?? "").trim();
  const required = ["Code", "Invoice", "Mark", "BCS", "Load", "Del", "USDA", "Origin"];
  const headerIndex = rows.findIndex(row => required.every(label => row.some(cell => text(cell) === label)));
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map(text);
  const lines: PickupLine[] = [];
  const destinations = new Set<string>();
  const invoices = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (index <= headerIndex || !row.some(cell => text(cell))) continue;
    const value = (label: string) => text(row[headers.indexOf(label)]);
    const invoice = value("Invoice").toUpperCase();
    const mark = value("Mark").toUpperCase();
    const warehouseCode = value("USDA");
    const warehouse = value("Origin");
    const bales = Number(value("BCS"));
    const weight = value("Wt") ? Number(value("Wt")) : null;
    const rtl = dispatchDate(value("Load"));
    const deliveryDate = dispatchDate(value("Del"));
    const destinationAddress = headers.flatMap((label, column) =>
      label === "Consignee Address" && text(row[column]) ? [text(row[column])] : []);
    if (value("Code") !== "O" || !/^[A-Z0-9]+$/.test(invoice) || invoices.has(invoice) ||
        !/^[A-Z0-9-]+$/.test(mark) || !/^\d{6}$/.test(warehouseCode) || !warehouse ||
        !Number.isSafeInteger(bales) || bales <= 0 || `${mark} ${bales} BALES`.length > 28 ||
        (weight !== null && (!Number.isFinite(weight) || weight <= 0)) ||
        !rtl || !deliveryDate || deliveryDate < rtl ||
        !value("Consignee") || !destinationAddress.length)
      throw Error(`Stapl row ${index + 1} has missing, invalid, or duplicate dispatch data.`);
    invoices.add(invoice);
    const address = [value("Consignee"), ...destinationAddress].join(", ");
    destinations.add(address);
    lines.push({
      sheet, row: index + 1, so: invoice, mark, bales, weight, warehouse, warehouseCode, rtl,
      address: [value("Origin City"), value("Origin ST"), value("Origin Zip")].filter(Boolean),
      stapl: { deliveryDate, destinationAddress },
    });
  }
  if (!lines.length || lines.length > 250) throw Error("Stapl CSV requires 1 to 250 dispatch rows.");
  return { lines, destinations: [...destinations], excluded: [] };
}
