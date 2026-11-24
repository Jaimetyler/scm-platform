import * as XLSX from "xlsx";
import { dispatchDate, type PickupLine } from "./preview";

export const TOYO_CUSTOMER = "TOYODATX";

const text = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalize = (value: unknown) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const street = (value: string) => normalize(value.replace(/\bAVENUE\b/gi, "AVE").replace(/\bROAD\b/gi, "RD"));

export function toyoDestinationMatches(source: string, selected: string) {
  return Boolean(street(source) && street(source) === street(selected));
}

export function parseToyoWorkbook(workbook: XLSX.WorkBook) {
  const lines: PickupLine[] = [];
  const destinations = new Set<string>();
  let destinationAddress = "";
  const seen = new Set<string>();
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "" });
    if (!rows.some(row => row.some(cell => /^TOYO COTTON\b/i.test(text(cell))))) continue;
    const required = ["MARK", "BALES", "WEIGHT", "WAREHOUSE", "LOADRTL"];
    const headerIndex = rows.findIndex(row => required.every(label => row.some(cell => normalize(cell) === label)));
    const prefix = rows.slice(0, headerIndex);
    const order = prefix.flat().map(text).map(cell => /^(WS-\d+)\s*,\s*(\d+)\s+MARKS?$/i.exec(cell)).find(Boolean);
    const carrier = prefix.flatMap(row => row.flatMap((cell, col) => normalize(cell) === "CARRIER" ? [text(row[col + 1])] : []))[0];
    const deliveryIndex = prefix.findIndex(row => row.some(cell => normalize(cell) === "DESTINATION"));
    const deliveryCol = prefix[deliveryIndex]?.findIndex(cell => normalize(cell) === "DESTINATION") ?? -1;
    const destination = text(prefix[deliveryIndex]?.[deliveryCol + 1]);
    const address = text(prefix[deliveryIndex + 1]?.[deliveryCol + 1]);
    const van = prefix.some(row => row.some(cell => normalize(cell) === "VANDISPATCH"));
    if (headerIndex < 0 || !order || !/SUPPLY\s+CHAIN\s+MANAGEMENT/i.test(carrier ?? "") ||
        !destination || !address || !van || (destinationAddress && !toyoDestinationMatches(destinationAddress, address)))
      throw Error("Toyo workbook requires an SCM van dispatch with a WS number and one delivery address.");
    destinationAddress = address;
    destinations.add([destination, address, text(prefix[deliveryIndex + 2]?.[deliveryCol + 1])].filter(Boolean).join(", "));
    const headers = rows[headerIndex].map(normalize);
    const col = (label: string) => headers.indexOf(label);
    const sheetLines: PickupLine[] = [];
    const codesByWarehouse = new Map<string, Set<string>>();
    let statedBales: number | undefined;
    let last: PickupLine | undefined;
    for (let index = headerIndex + 1; index < rows.length; index++) {
      const row = rows[index], mark = text(row[col("MARK")]).toUpperCase();
      // Some Toyo exports place Warehouse detail one column left of its heading.
      const warehouseCol = text(row[col("WAREHOUSE")]) ? col("WAREHOUSE") : col("WAREHOUSE") - 1;
      const warehouse = text(row[warehouseCol]);
      const total = /^TOTAL BALES:\s*(\d+)$/i.exec(mark);
      if (total) {
        statedBales = Number(total[1]);
        break;
      }
      if (!mark) {
        if (last && warehouse) last.address.push(warehouse);
        continue;
      }
      const so = order[1].toUpperCase();
      const bales = Number(row[col("BALES")]), weight = Number(row[col("WEIGHT")]);
      const warehouseCode = text(row[warehouseCol - 1]);
      const rtl = dispatchDate(row[col("LOADRTL")]);
      const key = `${so}:${mark}`;
      if (!/^[A-Z0-9-]+$/.test(mark) || !Number.isSafeInteger(bales) || bales <= 0 ||
          `${mark} ${bales} BALES`.length > 28 || !Number.isFinite(weight) || weight <= 0 ||
          !warehouse || (warehouseCode && !/^\d{6}$/.test(warehouseCode)) || !rtl || seen.has(key))
        throw Error(`Toyo row ${index + 1} has missing, invalid, or duplicate dispatch data.`);
      seen.add(key);
      const warehouseKey = normalize(warehouse);
      const codes = codesByWarehouse.get(warehouseKey) ?? new Set<string>();
      if (warehouseCode) codes.add(warehouseCode);
      codesByWarehouse.set(warehouseKey, codes);
      last = { sheet, row: index + 1, so, mark, bales, weight, warehouse, warehouseCode, rtl, address: [] };
      sheetLines.push(last);
    }
    if (!sheetLines.length || sheetLines.length !== Number(order[2]) ||
        (statedBales !== undefined && statedBales !== sheetLines.reduce((sum, line) => sum + line.bales, 0)))
      throw Error("Toyo mark or bale totals do not match the dispatch rows.");
    for (const line of sheetLines) {
      const codes = codesByWarehouse.get(normalize(line.warehouse));
      if (!line.warehouseCode && codes?.size === 1) line.warehouseCode = [...codes][0];
    }
    lines.push(...sheetLines);
  }
  if (!lines.length) return null;
  if (lines.length > 250) throw Error("Preview up to 250 pickup rows at a time.");
  return { lines, destinations: [...destinations], destinationAddress, excluded: [] };
}
