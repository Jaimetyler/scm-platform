import * as XlsxModule from "xlsx/xlsx.mjs";
import type * as XlsxTypes from "xlsx";
const XLSX = XlsxModule as typeof XlsxTypes;

export type OutboundLine = {
  mark: string; loadBy: string; confirmed: boolean; shippingOrder: string;
  warehouse: string; warehouseCode: string; bales: number; sourceRow: number;
};
export type BungeBooking = {
  bookingNumber: string; customerReference: string; customer: string;
  erd: string | null; docCutoff: string | null; cutoff: string | null; vessel: string | null;
  sourceDates: { label: string; value: string }[]; detailNotes: string[];
  containers: number | null; totalBales: number; lines: OutboundLine[];
  warehouses: string[]; warehouseDetails: Record<string, string>; warnings: string[];
};

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
function sheetRows(sheet: XlsxTypes.WorkSheet) {
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

// Footer labels move between Bunge layouts. Stop at the next label instead of consuming its value.
function labeledCell(sheet: XlsxTypes.WorkSheet, rows: unknown[][], labels: string[]) {
  const found = findLabel(rows, labels);
  if (!found) return null;
  for (let offset = 1; offset <= 12; offset++) {
    const col = found.col + offset;
    const raw = rows[found.row]?.[col];
    const text = String(raw ?? "").trim();
    if (!text) continue;
    if (/:$/.test(text)) return null;
    return sheet[XLSX.utils.encode_cell({ r: found.row, c: col })] ?? { v: raw };
  }
  return null;
}
function detailDate(cell: XlsxTypes.CellObject | null, label: string) {
  if (!cell || String(cell.v ?? "").trim() === "") return null;
  let year: number, month: number, day: number, hour = 0, minute = 0, hasTime = false;
  if (typeof cell.v === "number") {
    const parsed = XLSX.SSF.parse_date_code(cell.v);
    if (!parsed) throw new Error(`Invalid ${label} date in booking request.`);
    ({ y: year, m: month, d: day, H: hour, M: minute } = parsed);
    hasTime = parsed.H !== 0 || parsed.M !== 0 || parsed.S !== 0 || /[hs]/i.test(String(cell.z ?? ""));
  } else {
    const text = String(cell.v).trim();
    if (/^(?:N\/?A|TBD|TBA|-)$/i.test(text)) return null;
    const match = text.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?$/i);
    if (!match) throw new Error(`Invalid ${label} date in booking request.`);
    [year, month, day] = match[1].length === 4
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : [Number(match[3]), Number(match[1]), Number(match[2])];
    if (year < 100) year += 2000;
    hasTime = match[4] !== undefined;
    hour = Number(match[4] ?? 0); minute = Number(match[5] ?? 0);
    if (match[6]) {
      if (hour < 1 || hour > 12) throw new Error(`Invalid ${label} time in booking request.`);
      hour = hour % 12 + (match[6].toUpperCase() === "PM" ? 12 : 0);
    }
  }
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (year < 1900 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day ||
      parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute)
    throw new Error(`Invalid ${label} date in booking request.`);
  return parsed.toISOString().slice(0, hasTime ? 16 : 10);
}
function sailingDetails(sheet: XlsxTypes.WorkSheet, rows: unknown[][]) {
  const erd = detailDate(labeledCell(sheet, rows, ["ERD", "Earliest Receiving Date", "Early Receiving Date"]), "ERD")?.slice(0, 10) ?? null;
  const sourceDates = [
    { label: "C/O", aliases: ["C/O"] },
    { label: "Port Cut", aliases: ["Port Cut", "Port Cutoff", "Port Cut-off"] },
    { label: "Ramp Cut", aliases: ["Ramp Cut", "Ramp Cutoff", "Ramp Cut-off"] },
  ].flatMap(({ label, aliases }) => {
    const value = detailDate(labeledCell(sheet, rows, aliases), label);
    return value ? [{ label, value }] : [];
  });
  const unique = new Map<string, string>();
  for (const { value } of sourceDates) {
    const key = value.length === 10 ? `${value}T00:00` : value;
    if (!unique.has(key) || value.includes("T")) unique.set(key, value);
  }
  const distinct = [...unique].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  const explicitDoc = detailDate(labeledCell(sheet, rows, ["Doc Cut", "Doc Cutoff", "Doc Cut-off", "Documentation Cutoff"]), "Doc cutoff");
  const explicitCut = detailDate(labeledCell(sheet, rows, ["Cutoff", "Cut-off", "Cargo Cutoff", "Cargo Cut-off"]), "Cutoff");
  const docCutoff = explicitDoc ?? (distinct.length > 1 ? distinct[0] : null);
  const cutoff = explicitCut ?? distinct.at(-1) ?? null;
  const rawVessel = labeledCell(sheet, rows, ["Vessel/Voyage", "Vessel / Voyage", "Vessel", "Vessel Name"]);
  const vessel = String(rawVessel?.v ?? "").trim() || null;
  const detailNotes = distinct.length > 2 ? ["The request has more than two distinct cutoff dates. Review the earlier doc cutoff and later cutoff before saving."] : [];
  if (!explicitDoc && distinct.length > 1) detailNotes.push("Doc cutoff uses the earlier source date; Cutoff uses the later source date.");
  return { erd, docCutoff, cutoff, vessel, sourceDates, detailNotes };
}

export function parseBungeBooking(buffer: Buffer): BungeBooking {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellNF: true });
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
  return { ...sailingDetails(sheet, rows), bookingNumber, customerReference, customer, containers, totalBales, lines,
    warehouses: [...new Set(lines.map((line) => line.warehouse))], warehouseDetails, warnings };
}
export function warehouseMatchesSite(warehouse: string, terminal: string, siteCode: string, detail = "") {
  const text = `${warehouse} ${detail}`.toUpperCase();
  const city = terminal === "SAV" ? /SAVANNAH|GARDEN CITY|PORT WENTWORTH/ : /HOUSTON|BAYTOWN/;
  return city.test(text) && new RegExp(`(^|\\D)${siteCode}(\\D|$)`).test(text);
}
