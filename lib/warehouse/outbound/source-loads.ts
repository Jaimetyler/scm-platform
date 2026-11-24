import type { CellObject } from "xlsx";
import { resolveCottonLocation, type CottonLocation } from "../../cotton-import/location-resolution.ts";
import { detailDate } from "./bunge.ts";
import { outboundSteamshipLine } from "./booking-identifiers.ts";

export const sourceLoadRevenueCode = "CNTR";
const terminals = {
  BARBLATX: { kind: "port", names: ["BARBOURS CUT", "BARBOURS CUT TERMINAL"] },
  BAYPSETX: { kind: "port", names: ["BAYPORT", "BAYPORT TERMINAL"] },
  UNIOHOTX: { kind: "ramp", names: ["UNION PACIFIC", "UNIONE PACIFIC", "UP", "ENGLEWOOD"] },
  BNSFHOTX: { kind: "ramp", names: ["BNSF", "BSNF"] },
} as const;

const rates = new Map<string, { port: number; ramp: number }>([
  ["BRYAN", { port: 725, ramp: 775 }],
  ["CORPUS CHRISTI", { port: 1035, ramp: 1085 }],
  ["EL CAMPO", { port: 670, ramp: 720 }],
  ["GALVESTON", { port: 390, ramp: 440 }],
  ["HARLINGEN", { port: 1565, ramp: 1615 }],
  ["HOUSTON", { port: 350, ramp: 400 }],
  ["KENEDY", { port: 920, ramp: 970 }],
  ["LAREDO", { port: 1565, ramp: 1615 }],
  ["PORTLAND", { port: 1035, ramp: 1085 }],
  ["RAYMONDVILLE", { port: 1510, ramp: 1560 }],
  ["SEBASTIAN", { port: 1510, ramp: 1560 }],
  ["TAYLOR", { port: 865, ramp: 915 }],
  ["WESLACO", { port: 1620, ramp: 1670 }],
]);

type SourceLocation = CottonLocation & { city: string | null; state: string | null };
const text = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");
const label = (value: unknown) => text(value).replace(/[.:]+$/, "").trim().toUpperCase();
const positiveInteger = (value: unknown) => {
  const n = Number(text(value).replaceAll(",", ""));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const date = (value: unknown, name: string) =>
  detailDate({ v: typeof value === "number" ? value : text(value) } as CellObject, name);
const shortDate = (value: string | null) => value ? value.slice(5, 10).replace("-", "/") : "—";

export function previewToyoSourceLoads(rows: readonly (readonly unknown[])[], locations: readonly SourceLocation[]) {
  const header = rows.findIndex(row => ["BALES", "MARK", "CODE", "WAREHOUSE", "READY DATE", "GROSS WT"].every(name => row.map(label).includes(name)));
  if (header < 0 || !rows.slice(0, header).some(row => row.some(cell => /^TOYO COTTON\b/i.test(text(cell)))))
    throw Error("Upload a Toyo Cotton Dray Dispatch workbook.");
  const field = (name: string) => {
    for (const row of rows.slice(0, header)) {
      const index = row.findIndex(cell => label(cell) === name);
      if (index >= 0) {
        for (const cell of row.slice(index + 1)) {
          if (text(cell).endsWith(":")) break;
          if (text(cell)) return cell;
        }
        return undefined;
      }
    }
    return undefined;
  };
  const booking = text(field("BOOKING"));
  if (!booking) throw Error("Missing ocean booking number.");
  const rawSsl = text(field("S/S LINE"));
  const ssl = /^COSCO\b/i.test(rawSsl) ? "COSCO" : outboundSteamshipLine(rawSsl, booking);
  const loadedReturn = label(field("LOADED RETURN"));
  const returnTerminal = Object.entries(terminals).find(([code, data]) =>
    code === loadedReturn || data.names.some(name => name === loadedReturn));
  const [returnCode, terminal] = returnTerminal ?? [];
  const erd = date(field("1ST AVAIL / ERD"), "ERD");
  const docCutoff = date(field("DOC CUT"), "document cutoff");
  const portCutoff = date(field("PORT CUT"), "port cutoff");
  const rampCutoff = date(field("RAMP CUT"), "ramp cutoff");
  const cutoff = terminal?.kind === "ramp" ? rampCutoff : portCutoff;
  const planningComment = `Bkg# ${booking} - SSL ${ssl || "—"} - Doc Cut ${shortDate(docCutoff)} - Cutoff ${shortDate(cutoff)}`;
  const columns = rows[header].map(label);
  const lines = rows.slice(header + 1).flatMap((row, index) => {
    const cell = (name: string) => row[columns.indexOf(name)];
    const mark = label(cell("MARK"));
    if (!mark && !text(cell("CODE"))) return [];
    const issues: string[] = [];
    const bales = positiveInteger(cell("BALES"));
    const weight = positiveInteger(cell("GROSS WT"));
    const readyDate = date(cell("READY DATE"), "ready date")?.slice(0, 10) ?? null;
    const warehouseCode = text(cell("CODE"));
    let location: SourceLocation | undefined;
    try {
      const resolved = resolveCottonLocation(warehouseCode, locations);
      location = locations.find(candidate => candidate.id === resolved.id);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Warehouse code could not be matched.");
    }
    const laneRate = label(location?.state) === "TX" ? rates.get(label(location?.city)) : undefined;
    const baseRate = terminal ? laneRate?.[terminal.kind] ?? null : null;
    const blnum = bales && mark ? `${mark} ${bales} BALES` : null;
    if (!bales || !weight || !readyDate || !blnum || blnum.length > 28 || !/^[A-Z0-9][A-Z0-9 ./-]*$/.test(mark))
      issues.push("Check the mark, bale count, weight and ready date.");
    if (laneRate === undefined && location) issues.push("Missing base rate.");
    if (readyDate && cutoff && readyDate > cutoff.slice(0, 10)) issues.push("Ready date is after cutoff.");
    return [{
      sourceRow: header + index + 2, mark, bales, weight, readyDate, warehouseCode,
      pickupCode: location?.mcleod_code ?? null, city: location?.city ?? null, baseRate, issues,
      blnum, consignee_refno: mark, ordered_by: text(cell("SO")) || text(field("SO")) || undefined,
    }];
  });
  if (!lines.length) throw Error("No source load rows found.");
  const issues = [];
  if (!returnCode) issues.push("Choose a recognized loaded return terminal.");
  if (!ssl || !docCutoff || !cutoff) issues.push("Check SSL, document cutoff and loaded-return cutoff.");
  const containerCount = positiveInteger(text(field("CONTAINERS")).match(/^(\d+)\s*x\b/i)?.[1]);
  if (containerCount !== lines.length) issues.push("Container count differs from the number of source rows.");
  if (new Set(lines.map(line => line.mark)).size !== lines.length) issues.push("Duplicate marks in the dispatch.");
  return {
    customerId: "TOYODATX", orderType: "FSC", revenueCode: sourceLoadRevenueCode, booking, ssl, erd, docCutoff, cutoff, portCutoff, rampCutoff,
    loadedReturn, returnCode, equipmentRelease: text(field("EQUIP RELEASE")), planningComment,
    lines, issues, totalBaseRate: lines.every(line => line.baseRate !== null)
      ? lines.reduce((total, line) => total + (line.baseRate ?? 0), 0) : null,
  };
}
