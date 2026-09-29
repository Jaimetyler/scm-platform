import * as XLSX from "xlsx";

export type OutboundLine = {
  mark: string; loadBy: string; confirmed: boolean; shippingOrder: string;
  warehouse: string; warehouseCode: string; bales: number; sourceRow: number;
};
export type BungeBooking = {
  bookingNumber: string; customerReference: string; customer: string;
  containers: number | null; totalBales: number; lines: OutboundLine[];
  warehouses: string[]; warehouseDetails: Record<string, string>; warnings: string[];
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

function normalized(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").replace(/[:.]+$/, "").toUpperCase();
}
function sheetRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
}
function findLabel(rows: unknown[][], labels: string[], maxRows = rows.length) {
  const wanted = new Set(labels.map(normalized));
  for (let row = 0; row < Math.min(rows.length, maxRows); row++) {
    for (let col = 0; col < rows[row].length; col++) {
      if (wanted.has(normalized(rows[row][col]))) return { row, col };
    }
  }
  return null;
}
function nearbyValue(rows: unknown[][], labels: string[], maxRows = rows.length) {
  const found = findLabel(rows, labels, maxRows);
  if (!found) return "";
  for (let offset = 1; offset <= 12; offset++) {
    const candidate = String(rows[found.row]?.[found.col + offset] ?? "").trim();
    if (candidate) return candidate;
  }
  return "";
}
function headerColumn(row: unknown[], labels: string[]) {
  const wanted = new Set(labels.map(normalized));
  const index = row.findIndex((cell) => wanted.has(normalized(cell)));
  return index >= 0 ? index : null;
}

export function parseBungeBooking(buffer: Buffer): BungeBooking {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no readable worksheet.");
  const rows = sheetRows(sheet);
  if (!findLabel(rows, ["Booking Request"], 25)) throw new Error("This does not appear to be a booking request.");

  let headerRow = -1;
  let columns: Record<string, number> | null = null;
  for (let row = 0; row < Math.min(rows.length, 100); row++) {
    const mark = headerColumn(rows[row], ["Mark"]);
    const loadBy = headerColumn(rows[row], ["Load By", "Load Date"]);
    const warehouse = headerColumn(rows[row], ["Warehouse", "Warehouse Name"]);
    const bales = headerColumn(rows[row], ["Bales", "Bale Count", "Bales Requested"]);
    if (mark !== null && loadBy !== null && warehouse !== null && bales !== null) {
      headerRow = row;
      columns = { mark, loadBy, warehouse, bales,
        confirmed: headerColumn(rows[row], ["Conf", "Confirmed"]) ?? -1,
        shippingOrder: headerColumn(rows[row], ["S.O", "S.O.", "Shipping Order", "Shipping Order #"]) ?? -1 };
      break;
    }
  }
  if (!columns) throw new Error("Could not find the Mark, Load By, Warehouse, and Bales columns.");

  const bookingNumber = nearbyValue(rows, ["Booking #", "Booking Number"], headerRow).toUpperCase();
  if (!/^[A-Z0-9_/-]{3,40}$/.test(bookingNumber)) throw new Error("Missing or invalid booking number.");
  const customerReference = nearbyValue(rows, ["Customer Reference", "Customer Ref", "Customer's Ref.No"], headerRow);
  const customer = String(rows[findLabel(rows, ["Booking Request"], 25)!.row + 1]?.find((cell) => String(cell).trim()) ?? "").trim()
    || "Bunge USA Agriculture LLC";

  const summaryStart = findLabel(rows, ["Warehouse Contact Summary"], rows.length)?.row ?? rows.length;
  const lines: OutboundLine[] = [];
  for (let row = headerRow + 1; row < Math.min(summaryStart, rows.length); row++) {
    const mark = String(rows[row]?.[columns.mark] ?? "").trim().toUpperCase();
    if (!mark || /^CONF\b/.test(mark)) continue;
    const warehouse = String(rows[row]?.[columns.warehouse] ?? "").trim();
    const balesRaw = String(rows[row]?.[columns.bales] ?? "").trim();
    if (!warehouse || !balesRaw) continue;
    if (!/^[A-Z0-9][A-Z0-9 ./-]{0,79}$/i.test(mark)) throw new Error(`Row ${row + 1}: invalid mark`);
    const shippingCells = columns.shippingOrder >= 0
      ? rows[row].slice(columns.shippingOrder, columns.warehouse).map((cell) => String(cell ?? "").trim()).filter(Boolean) : [];
    lines.push({ mark, loadBy: date(rows[row]?.[columns.loadBy], row + 1),
      confirmed: columns.confirmed >= 0 && normalized(rows[row]?.[columns.confirmed]) === "Y",
      shippingOrder: shippingCells[0] ?? "", warehouseCode: shippingCells[1] ?? "",
      warehouse, bales: positive(balesRaw, "bale count", row + 1), sourceRow: row + 1 });
  }
  if (!lines.length) throw new Error("No complete mark rows were found in the booking request.");

  const totalBales = lines.reduce((sum, line) => sum + line.bales, 0);
  const warnings: string[] = [];
  const statedTotal = nearbyValue(rows, ["Total Bales"], rows.length);
  if (statedTotal && Number(String(statedTotal).replace(/,/g, "")) !== totalBales)
    warnings.push(`The sheet total (${statedTotal}) differs from the mark total (${totalBales}).`);
  const containerText = nearbyValue(rows, ["Containers", "Container Qty", "Container Quantity"], rows.length);
  const containers = containerText ? positive(containerText, "container count", findLabel(rows, ["Containers"], rows.length)?.row ?? 0) : null;

  const warehouseDetails: Record<string, string> = {};
  if (summaryStart < rows.length) {
    for (let row = summaryStart + 1; row < Math.min(summaryStart + 30, rows.length); row++) {
      const code = String(rows[row]?.[0] ?? "").trim();
      if (/^TOTAL BALES:?$/i.test(code)) break;
      if (!/^\d+$/.test(code)) continue;
      warehouseDetails[code] = rows[row].slice(1).map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" ");
    }
  }
  return { bookingNumber, customerReference, customer, containers, totalBales, lines,
    warehouses: [...new Set(lines.map((line) => line.warehouse))], warehouseDetails, warnings };
}
export function warehouseMatchesSite(warehouse: string, terminal: string, siteCode: string, detail = "") {
  const text = `${warehouse} ${detail}`.toUpperCase();
  const city = terminal === "SAV" ? /SAVANNAH|GARDEN CITY|PORT WENTWORTH/ : /HOUSTON|BAYTOWN/;
  return city.test(text) && new RegExp(`(^|\\D)${siteCode}(\\D|$)`).test(text);
}
