import Papa from "papaparse";
import { PROFILE, SAVANNAH_RATES, normalize, invoiceDate, money, type DrayInvoice } from "./model.ts";

export function containerKey(value: unknown): string {
  const s = normalize(value).replace(/[\s-]/g, "");
  if (/^[A-Z]{4}\d{7}$/.test(s)) return s.slice(0, -1);
  if (/^[A-Z]{4}\d{6}$/.test(s)) return s;
  throw new Error(`Invalid container: ${s.slice(0,30)}`);
}
export function portLocation(value: unknown): string | null {
  const s = normalize(value).replace(/\s/g, "");
  return s === "GPA" ? "SAVPORT" : ["OT","OCEANTERMINAL"].includes(s) ? "SAVOT" : null;
}
const header = (value: unknown) => normalize(value).replace(/[^A-Z0-9]/g, "");
function table(rows: unknown[][], required: string[]) {
  const index = rows.findIndex(row => required.every(name => row.map(header).includes(name)));
  if (index < 0) throw new Error("Original report headers are required, including Pickup Point and SS LINE.");
  const names = rows[index].map(header);
  if (required.some(name => names.filter(v => v === name).length !== 1)) throw new Error("Duplicate report headers.");
  return rows.slice(index + 1).map((row, i) => ({line:index+i+2, get:(name:string) => String(row[names.indexOf(name)] ?? "").trim()}));
}
export function parseDrays(csv: string, firstStarRows: unknown[][]) {
  if (typeof csv !== "string" || csv.length > 2_000_000) throw new Error("Dray report exceeds 2 MB.");
  if (!Array.isArray(firstStarRows) || firstStarRows.length > 30001) throw new Error("FirstStar listing exceeds 30,000 rows.");
  const parsed = Papa.parse<string[]>(csv, {skipEmptyLines:"greedy"});
  if (parsed.errors.length) throw new Error("Dray CSV could not be parsed.");
  const drays = table(parsed.data, ["INVOICEDATE","SHIPPERID","SHIPPER","MARKS","FILENUMBER","PICKUPPOINT","SSLINE","EQUIPMENTTRACKING","SHIPPINGORDER","BOOKINGNUMBER","CHASSIS","SEALNUMBER"]);
  const history = table(firstStarRows, ["LOAD","TERM","CONTAINER","BILLREF","TOTAL","VOIDED"]);
  const lookup = new Map<string, typeof history>();
  for (const row of history) {
    // Voided and other-terminal rows are not eligible carrier-rate sources.
    if (row.get("TERM") !== "700" || row.get("VOIDED")) continue;
    try { const k = containerKey(row.get("CONTAINER")); lookup.set(k, [...(lookup.get(k)||[]), row]); } catch { /* unrelated chassis / domestic rows */ }
  }
  const invoices: DrayInvoice[] = [], skipped: {line:number;reason:string}[] = [];
  const sourceKeys = new Set<string>();
  for (const row of drays) {
    if (!row.get("INVOICEDATE") && !row.get("SHIPPERID")) continue; // footer
    if (!row.get("PICKUPPOINT") || !row.get("SSLINE") || normalize(row.get("SSLINE")).replace(/\s/g, "") === "NOBILL") {
      skipped.push({line:row.line,reason:"NOBILL or missing port / steamship line"}); continue;
    }
    const errors: string[] = [], destination = portLocation(row.get("PICKUPPOINT"));
    if (!destination) errors.push("Unknown port terminal: " + row.get("PICKUPPOINT"));
    const rate = SAVANNAH_RATES.find(c => c.aliases.some(a => normalize(a) === normalize(row.get("SHIPPER"))));
    if (!rate) errors.push("Customer billing mapping is not configured");
    const container = normalize(row.get("EQUIPMENTTRACKING")).replace(/[\s-]/g, "");
    let k = ""; try { k = containerKey(container); } catch (e) { errors.push((e as Error).message); }
    if (!/^[A-Z]{4}\d{7}$/.test(container)) errors.push("Dray source must retain the full container number");
    const fileNumber = row.get("FILENUMBER"), shippingOrder = row.get("SHIPPINGORDER"), reference = row.get("MARKS");
    if (!shippingOrder || !reference || !fileNumber) errors.push("Shipping order, mark and file number are required");
    if (reference.length > 28 || container.length > 28 || row.get("BOOKINGNUMBER").length > 40 || fileNumber.length > 80) errors.push("Mapped McLeod field exceeds its length limit");
    let date = ""; try { date = invoiceDate(row.get("INVOICEDATE")); } catch(e) { errors.push((e as Error).message); }
    const matches = lookup.get(k)||[];
    // A matching file is a corroboration, never a substitute for the container.
    const sameFile = matches.filter(m => normalize(m.get("BILLREF")).replace(/^FILE\s*/, "").trim() === normalize(fileNumber));
    const candidates = sameFile.length ? sameFile : matches;
    let carrierCents: number | null = null, firstStarLoad: string | null = null;
    if (candidates.length !== 1) errors.push(candidates.length ? "Multiple FirstStar moves match this container / file" : "No FirstStar container match");
    else {
      const match = candidates[0];
      if (match.get("BILLREF") && !sameFile.length) errors.push("FirstStar file reference differs from dray report");
      try { carrierCents = money(match.get("TOTAL")); if (carrierCents <= 0) errors.push("Carrier pay must be positive"); } catch { errors.push("FirstStar carrier pay is missing or invalid"); }
      firstStarLoad = match.get("LOAD");
      if (!/^[A-Za-z0-9_-]+$/.test(firstStarLoad)) errors.push("FirstStar load ID is invalid");
    }
    const baseCents = rate && destination ? destination === "SAVOT" ? rate.ocean : rate.port : 0;
    const charges = rate ? [{code:"040",description:"SAV Chassis Charges",units:rate.code === "OLAMRITX" ? 2 : 1,cents:rate.chassis}] : [];
    if (rate?.code === "OLAMRITX") charges.unshift({code:"040",description:"GARDEN CITY TO SAVANNAH",units:1,cents:0});
    const sourceKey = `${shippingOrder}:${container}`;
    if (sourceKeys.has(sourceKey)) throw new Error("Duplicate shipping order / container in dray report");
    sourceKeys.add(sourceKey);
    invoices.push({reference,mark:container,invoiceDate:date,shipperId:row.get("SHIPPERID"),customerName:row.get("SHIPPER"),customerId:rate?.code||"",
      cents:baseCents+charges.reduce((n,c)=>n+c.cents,0),charges,sourceKey,shippingOrder,container,chassis:row.get("CHASSIS"),seal:row.get("SEALNUMBER"),fileNumber,
      booking:row.get("BOOKINGNUMBER"),steamship:row.get("SSLINE"),destination:destination||"",baseCents,carrierCents,firstStarLoad,inputErrors:errors});
  }
  if (!invoices.length) throw new Error("No eligible port drays were found.");
  if (invoices.length > 500) throw new Error("Maximum 500 drays per import.");
  return {profile:PROFILE,invoices,skipped};
}
