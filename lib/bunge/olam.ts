import * as XLSX from "xlsx";
import { OLAM_DELIVERY_LOCATIONS } from "./destinations";
import { dispatchDate, type PickupLine } from "./preview";

const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");
const header = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseOlamWorkbook(workbook: XLSX.WorkBook) {
  const lines: PickupLine[] = [];
  const destinations = new Set<string>();
  const resolved = new Set<string>();
  const excluded: { sheet: string; row: number; reason: string }[] = [];
  let detected = false;
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, raw: true, defval: "" });
    if (!rows.slice(0, 10).some(row => row.some(cell => header(cell) === "OLAMAMERICACOTTONCOMPANY"))) continue;
    detected = true;
    const required = ["MARK", "SO", "BALES", "WAREHOUSE", "WAREHOUSENAME", "READYCONFIRMEDLOADRTL"];
    const index = rows.findIndex(row => required.every(key => row.map(header).includes(key)));
    if (index < 0) throw Error(`${sheet}: OLAM load list headers are missing.`);
    const headings = rows[index].map(header);
    let carrier = "";
    let name = "";
    let address = "";
    let code = "";
    let bookingNumber = "";
    for (const [i, row] of rows.slice(0, index).entries()) {
      if (header(row[0]) === "CARRIER") carrier = clean(row[1]);
      if (header(row[0]) === "DESTINATION") {
        name = clean(row[1]);
        address = clean(rows[i + 1]?.[1]);
      }
      if (["BOOKING", "BOOKINGNO", "BOOKINGNUMBER"].includes(header(row[0]))) bookingNumber = clean(row[1]);
      if (header(row[0]) === "DESTCODE") code = clean(row[1]);
    }
    destinations.add([name, address, code].filter(Boolean).join(" · "));
    const namedCode = OLAM_DELIVERY_LOCATIONS.find(location => location.code === code.toUpperCase())?.code;
    const sutton = /\bSUTTON\s+(?:ROAD|RD)\b/i.test(address);
    const cedar = /\bCEDAR\s+(?:BOULEVARD|BLVD)\b/i.test(address);
    const addressCode = /\bMERIH\b/i.test(name) ? sutton ? "MERIBAT2" : cedar ? "MERIBATX" : "" : "";
    const sourceCode = code === "819201" ? "MERIBAT2" : namedCode;
    resolved.add(sourceCode && addressCode && sourceCode !== addressCode ? "" : sourceCode || addressCode);

    for (const [i, row] of rows.slice(index + 1).entries()) {
      const get = (key: string) => row[headings.indexOf(key)];
      const mark = clean(get("MARK")).toUpperCase();
      const so = clean(get("SO"));
      const bales = clean(get("BALES"));
      if (!mark && !so && !bales) continue;
      const rowNumber = index + i + 2;
      if (!/SUPPLY\s+CHAIN\s+MANAGEMENT/i.test(carrier)) {
        excluded.push({ sheet, row: rowNumber, reason: "Carrier is not Supply Chain Management." });
        continue;
      }
      const warehouse = clean(get("WAREHOUSENAME"));
      const rawWarehouseCode = clean(get("WAREHOUSE"));
      // Excel stores EWR codes as numbers and can drop leading zeroes.
      const warehouseCode = /^\d{1,6}$/.test(rawWarehouseCode) ? rawWarehouseCode.padStart(6, "0") : rawWarehouseCode;
      if (!/^[A-Z0-9-]{1,30}$/.test(mark) || !/^\d{1,20}$/.test(so) ||
          !Number.isSafeInteger(Number(bales)) || Number(bales) <= 0 || !warehouse || !/^\d{6}$/.test(warehouseCode)) {
        throw Error(`${sheet} row ${rowNumber}: invalid mark, SO, bale count or warehouse.`);
      }
      const bookingColumn = ["BOOKING", "BOOKINGNO", "BOOKINGNUMBER"].find(key => headings.includes(key));
      const rowBooking = bookingColumn ? clean(get(bookingColumn)) : bookingNumber;
      lines.push({ ...(rowBooking ? { bookingNumber: rowBooking } : {}), sheet, row: rowNumber, mark, so, bales: Number(bales), warehouse, warehouseCode,
        weight: clean(get("WEIGHT")) ? Number(get("WEIGHT")) : null, address: [],
        rtl: dispatchDate(get("READYCONFIRMEDLOADRTL")) });
    }
  }
  if (!detected) return null;
  if (!lines.length) throw Error("No OLAM pickup rows for Supply Chain Management.");
  if (lines.length > 250) throw Error("Preview up to 250 pickup rows at a time.");
  return { lines, destinations: [...destinations].filter(Boolean), excluded,
    destination: resolved.size === 1 ? [...resolved][0] : "" };
}

