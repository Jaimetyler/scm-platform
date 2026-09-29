import * as XLSX from "xlsx";

export type OutboundLine = {
  mark: string; loadBy: string; confirmed: boolean; shippingOrder: string;
  warehouse: string; warehouseCode: string; bales: number; sourceRow: number;
};
export type BungeBooking = {
  bookingNumber: string; customerReference: string; customer: string;
  containers: number | null; totalBales: number; lines: OutboundLine[];
  warehouses: string[]; warnings: string[];
};

function value(sheet: XLSX.WorkSheet, address: string) {
  return String(sheet[address]?.v ?? "").trim();
}
function positive(value: string, field: string, row: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Row ${row}: invalid ${field}`);
  return number;
}
function date(value: unknown, row: number) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) throw new Error(`Row ${row}: invalid load-by date`);
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const result = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2])));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() + 1 !== Number(match[1]) || result.getUTCDate() !== Number(match[2]))
    throw new Error(`Row ${row}: invalid load-by date`);
  return result.toISOString().slice(0, 10);
}

export function parseBungeBooking(buffer: Buffer): BungeBooking {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet || value(sheet, "X1").toLowerCase() !== "booking request" ||
      value(sheet, "A12").toLowerCase() !== "mark" || value(sheet, "P12").toLowerCase() !== "bales") {
    throw new Error("This is not the expected Bunge booking request format.");
  }
  const bookingNumber = value(sheet, "F8").toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(bookingNumber)) throw new Error("Missing or invalid booking number in F8.");
  const lines: OutboundLine[] = [];
  for (let row = 13; row <= 1000; row++) {
    const mark = value(sheet, `A${row}`).toUpperCase();
    if (!mark || /^(CONF|WAREHOUSE CONTACT|TOTAL BALES)/.test(mark)) break;
    const warehouse = value(sheet, `I${row}`);
    if (!/^[A-Z0-9][A-Z0-9 .\/-]{0,79}$/i.test(mark) || !warehouse)
      throw new Error(`Row ${row}: invalid mark or missing warehouse`);
    lines.push({ mark, loadBy: date(sheet[`C${row}`]?.v, row),
      confirmed: value(sheet, `E${row}`).toUpperCase() === "Y",
      shippingOrder: value(sheet, `G${row}`), warehouseCode: value(sheet, `H${row}`),
      warehouse, bales: positive(value(sheet, `P${row}`), "bale count", row), sourceRow: row });
  }
  if (!lines.length) throw new Error("No mark rows were found in the booking request.");
  const totalBales = lines.reduce((sum, line) => sum + line.bales, 0);
  const containers = value(sheet, "D32") ? positive(value(sheet, "D32"), "container count", 32) : null;
  const warnings: string[] = [];
  if (value(sheet, "D31") && Number(value(sheet, "D31")) !== totalBales)
    warnings.push(`The sheet total (${value(sheet, "D31")}) differs from the mark total (${totalBales}).`);
  return { bookingNumber, customerReference: value(sheet, "F10"), customer: value(sheet, "X2") || "Bunge USA Agriculture LLC",
    containers, totalBales, lines, warehouses: [...new Set(lines.map((line) => line.warehouse))], warnings };
}

export function warehouseMatchesSite(warehouse: string, terminal: string, siteCode: string) {
  const text = warehouse.toUpperCase();
  const city = terminal === "SAV" ? /SAVANNAH|GARDEN CITY|PORT WENTWORTH/ : /HOUSTON|BAYTOWN/;
  return city.test(text) && new RegExp(`(^|\\D)${siteCode}(\\D|$)`).test(text);
}
