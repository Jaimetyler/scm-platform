import { unzipSync, zipSync } from "fflate";
import * as XlsxModule from "xlsx/xlsx.mjs";
import type * as XlsxTypes from "xlsx";
import { parseBungeBooking, detailDate, classifyBookingLoads, type BungeBooking, type OutboundLine } from "./bunge.ts";
import { isSavannahE2openBooking } from "./e2open-customer.ts";
import { outboundBookingNumber, outboundSteamshipLine } from "./booking-identifiers.ts";
const XLSX = XlsxModule as typeof XlsxTypes;
export type BookingImport = BungeBooking & {
  sourceFormat: "bunge" | "olam" | "edf" | "ldc" | "toyo";
  customerNeedsConfirmation?: boolean; needsDateYear?: boolean; warehouseNeedsConfirmation?: boolean; edfScheduleOnly?: boolean;
};
export type BookingImportOptions = { dateYear?: string; bales?: Record<string, unknown>; customerConfirmed?: boolean; warehouseConfirmed?: boolean };
const text = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const norm = (v: unknown) => text(v).replace(/[:.]+$/, "").trim().toUpperCase();
const identifier = (v: unknown, label: string) => {
  const s = text(v).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_ ./-]{0,79}$/.test(s)) throw Error(`Missing or invalid ${label}.`);
  return s;
};
const bookingIdentifier = (value: unknown) => identifier(outboundBookingNumber(value), "booking number");
const count = (v: unknown, label: string) => {
  const n = Number(text(v).replace(/,/g, ""));
  if (!Number.isSafeInteger(n) || n <= 0 || n > 1000000) throw Error(`Enter a positive ${label}.`);
  return n;
};
const edfCommonHeaders = ["ocean_carrier_name", "ocean_vessel_name", "stuffing_reference", "carrier_booking_number", "exporter_ref_po_number", "container_num_stuffed"];
const edfDispatchHeaders = ["stuffing_place", "earliest_return_date", "terminal_cutoff", "document_cutoff", "full_return_place"];
const edfScheduleHeaders = ["ocean_pol", "ocean_pod", "etd", "eta", "delivery_order_status", "stuffing_date"];

const ldcHeaders = ["TMS ID", "Order Ref", "Shipper", "Origin Name", "Destination Name", "Trailer", "Shipment References"];

function parseToyoBooking(buffer: Buffer): BookingImport {
  // The dispatch form uses RTF tabs as columns and paragraphs as rows.
  const rows = buffer.toString("latin1")
    .replace(/\r?\n/g, "")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\(?:tab|par|line)\b ?/g, token => token.startsWith("\\tab") ? "\t" : "\n")
    .replace(/\\'[\da-f]{2}/gi, token => String.fromCharCode(parseInt(token.slice(2), 16)))
    .replace(/\\[a-z]+-?\d* ?|[{}]/gi, "")
    .split("\n").map(row => row.split("\t").map(text));
  const field = (label: string) => {
    for (const row of rows) {
      const col = row.findIndex(cell => norm(cell) === norm(label));
      if (col >= 0) return row[col + 1] ?? "";
    }
    return "";
  };
  const header = rows.findIndex(row => ["BALES", "MARK", "CODE", "WAREHOUSE", "READY DATE"].every(label => row.map(norm).includes(label)));
  if (header < 0 || !/^TOYO COTTON\b/i.test(field("Customer"))) throw Error("Toyo Cotton dispatch format not recognized.");
  const columns = rows[header].map(norm).filter(Boolean);
  const lines: OutboundLine[] = [];
  let statedTotal: number | null = null;
  for (const [index, row] of rows.slice(header + 1).entries()) {
    const cells = row.slice(row.findIndex(Boolean));
    if (cells.includes("*TOTAL*")) {
      statedTotal = count(cells[0], "total bale count");
      break;
    }
    if (!/^\d[\d,]*$/.test(cells[0] ?? "")) continue;
    const cell = (label: string) => cells[columns.indexOf(label)];
    const warehouseCode = cell("CODE");
    if (warehouseCode !== "913054") throw Error("Toyo dispatch requires the Baytown 5300 warehouse code 913054.");
    const warehouse = cell("WAREHOUSE");
    if (!warehouse) throw Error("Missing warehouse name on Toyo dispatch.");
    lines.push({ mark: identifier(cell("MARK"), "mark"), shippingOrder: "", warehouse, warehouseCode,
      bales: count(cell("BALES"), "bale count"), sourceRow: header + index + 2, confirmed: false,
      loadBy: detailDate({ v: cell("READY DATE") } as XlsxTypes.CellObject, "ready date")?.slice(0, 10) ?? null });
  }
  if (!lines.length) throw Error("No Toyo mark rows were found.");
  const totalBales = lines.reduce((sum, line) => sum + line.bales, 0);
  if (statedTotal !== null && statedTotal !== totalBales) throw Error("Toyo total bale count differs from its mark rows.");
  const date = (label: string) => detailDate({ v: field(label) } as XlsxTypes.CellObject, label);
  const cutoff = date("Port Cut");
  if (!cutoff) throw Error("Missing Port Cut on Toyo dispatch.");
  const bookingNumber = bookingIdentifier(field("Booking"));
  const returnLocation = field("Loaded Return");
  return { sourceFormat: "toyo", customer: "Toyo Cotton Company", bookingNumber,
    customerReference: field("Booking Ref"), containers: count(field("Containers").match(/^(\d+)\s*x\b/i)?.[1], "container count"),
    totalBales, lines, warehouses: [...new Set(lines.map(line => line.warehouse))], warehouseDetails: {}, warnings: [],
    returnLocation, loadPort: returnLocation, steamshipLine: outboundSteamshipLine(field("S/S Line"), bookingNumber),
    vessel: field("Vessel/Voyage") || null, erd: date("1st Avail / ERD")?.slice(0, 10) ?? null,
    docCutoff: date("Doc Cut"), cutoff, sourceDates: [{ label: "Port Cut", value: cutoff }],
    detailNotes: [`Equipment release: ${field("Equip Release")}.`] };
}

export function parseBookingRequest(buffer: Buffer, options: BookingImportOptions = {}): BookingImport {
  if (buffer.subarray(0, 5).toString() === "{\\rtf") return parseToyoBooking(buffer);
  // e2open streams its ZIP entries with data descriptors, which this XLSX reader misreads.
  let source = buffer;
  if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0x04034b50 && (buffer.readUInt16LE(6) & 8) !== 0) {
    let expandedBytes = 0;
    const entries = unzipSync(buffer, { filter: entry => {
      expandedBytes += entry.originalSize;
      if (expandedBytes > 100 * 1024 * 1024) throw Error("Expanded booking workbook is too large.");
      return true;
    } });
    source = Buffer.from(zipSync(entries, { level: 0 }));
  }
  const workbook = XLSX.read(source, { type: "buffer", cellDates: false, cellNF: true });
  const candidates = workbook.SheetNames.flatMap(name => {
    const sheet = workbook.Sheets[name];
    const rowOptions = { header: 1 as const, raw: true, defval: "" };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, rowOptions);
    // The carrier export declares its data range below its physical header row.
    const fullRows = sheet["!ref"] && XLSX.utils.decode_range(sheet["!ref"]).s.r > 0
      ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...rowOptions, range: 0 })
      : rows;
    const first = rows.slice(0, 25).flat().map(norm);
    const edf = rows.findIndex(row => {
      const headers = new Set(row.map(text));
      return edfCommonHeaders.every(h => headers.has(h)) &&
        (edfDispatchHeaders.every(h => headers.has(h)) || edfScheduleHeaders.every(h => headers.has(h)));
    });
    const ldc = fullRows.findIndex(row => ldcHeaders.every(h => row.map(norm).includes(norm(h))));
    const olam = first.includes("DRAY DISPATCH") && first.some(v => /^OLAM AGRI AMERICAS INC\.?$/.test(v));
    const bunge = first.includes("BOOKING REQUEST") && first.some(v => /^BUNGE USA AGRICULTURE\s*,?\s*LLC\.?$/.test(v));
    return edf >= 0 || ldc >= 0 || olam || bunge ? [{ sheet, rows: edf < 0 && ldc >= 0 ? fullRows : rows, format: edf >= 0 ? "edf" : ldc >= 0 ? "ldc" : olam ? "olam" : "bunge", header: edf >= 0 ? edf : ldc }] : [];
  });
  if (candidates.length !== 1) throw Error(candidates.length ? "Upload one booking worksheet at a time." : "Customer or booking format not recognized. Supported: Bunge, Olam Dray Dispatch, ED&F inland drayage, and LDC e2open exports.");
  const { sheet, rows, format, header } = candidates[0];
  if (format === "bunge") {
    // Existing parser reads the first worksheet; pass the recognized sheet explicitly.
    const only = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(only, sheet, "Booking");
    return { ...parseBungeBooking(XLSX.write(only, { type: "buffer", bookType: "xlsx" })), sourceFormat: "bunge" };
  }
  const base = { erd: null, docCutoff: null, cutoff: null, vessel: null, sourceDates: [], detailNotes: [], warnings: [], warehouseDetails: {} } as Pick<BungeBooking, "erd" | "docCutoff" | "cutoff" | "vessel" | "sourceDates" | "detailNotes" | "warnings" | "warehouseDetails">;
  if (format === "ldc") {
    const column = (label: string) => rows[header].findIndex(value => norm(value) === norm(label));
    const data = rows.slice(header + 1).map((row, index) => ({ row, sourceRow: header + index + 2 }))
      .filter(({ row }) => row.some(value => text(value)));
    if (!data.length || data.length > 500) throw Error("LDC export must contain between 1 and 500 load rows.");
    const bookings = new Set<string>();
    const destinations = new Set<string>();
    const loadIds = new Set<string>();
    const notes: string[] = [];
    const lines: OutboundLine[] = data.map(({ row, sourceRow }) => {
      const value = (label: string) => text(row[column(label)]);
      if (!isSavannahE2openBooking("SAV", value("Shipper"))) throw Error(`Row ${sourceRow}: expected Louis Dreyfus as shipper.`);
      const loadId = value("TMS ID");
      if (!/^\d+$/.test(loadId) || loadIds.has(loadId)) throw Error(`Row ${sourceRow}: invalid or repeated e2open load ID.`);
      loadIds.add(loadId);
      const references = value("Shipment References");
      const reference = (pattern: RegExp, label: string, required = true) => {
        const values = [...new Set([...references.matchAll(pattern)].map(match => norm(match[1])))];
        if (values.length > 1 || required && !values.length) throw Error(`Row ${sourceRow}: missing or conflicting ${label}.`);
        return values[0] ?? "";
      };
      const booking = reference(/(?:^|,)\s*Booking\s*#\s*:\s*([^,]+)/gi, "booking number");
      const mark = identifier(reference(/(?:^|,)\s*Pick-up\s*#\s*:\s*([^,]+)/gi, "pickup reference"), "mark");
      const seal = reference(/(?:^|,)\s*Seal\s*#\s*:\s*([^,]+)/gi, "seal number", false);
      const order = value("Order Ref").match(/^(\S+)\s+-\s+(.+)$/);
      if (!order || norm(order[2]) !== mark) throw Error(`Row ${sourceRow}: order reference does not match pickup ${mark}.`);
      const warehouse = value("Origin Name");
      if (!/^SUPPLY CHAIN MANAGEMENT\s*-\s*PORT WENTWORTH$/i.test(warehouse))
        throw Error(`Row ${sourceRow}: expected the SCM Port Wentworth origin.`);
      bookings.add(bookingIdentifier(booking));
      destinations.add(value("Destination Name"));
      notes.push(`${mark} · e2open load ${loadId} · seal ${seal || "—"} · chassis ${value("Trailer") || "—"}`);
      const supplied = options.bales?.[String(sourceRow)];
      return { mark, shippingOrder: identifier(order[1], "shipping order"), warehouse, warehouseCode: "", sourceRow,
        bales: supplied === undefined || supplied === "" ? 0 : count(supplied, "bale count"),
        needsBales: true, loadBy: null, confirmed: false };
    });
    if (bookings.size !== 1 || destinations.size !== 1) throw Error("Upload one LDC booking with one return location at a time.");
    const returnLocation = [...destinations][0];
    return { ...base, sourceFormat: "ldc", customer: "Louis Dreyfus Company Cotton", warehouseNeedsConfirmation: true,
      bookingNumber: [...bookings][0], steamshipLine: outboundSteamshipLine("", [...bookings][0]), customerReference: "", containers: lines.length, totalBales: lines.reduce((sum, line) => sum + line.bales, 0),
      lines, warehouses: [...new Set(lines.map(line => line.warehouse))], returnLocation, loadPort: returnLocation,
      detailNotes: ["Enter the bale count for each load. The export does not supply container numbers or sailing cutoffs.",
        "Seal and chassis values are shown for reference. Enter equipment on the saved booking when the container number is available.", ...notes] };
  }
  if (format === "olam") {
    const field = (label: string) => {
      for (const row of rows.slice(0, 34)) { const i = row.findIndex(v => norm(v) === norm(label)); if (i >= 0) return row[i + 1]; }
      return "";
    };
    const date = (label: string) => detailDate({ v: field(label) } as XlsxTypes.CellObject, label);
    const headerRow = rows.findIndex(row => ["BALES", "MARK", "SO", "WHSE", "WAREHOUSE"].every(h => row.map(norm).includes(h)));
    if (headerRow < 0) throw Error("Olam mark columns could not be read.");
    const col = (label: string) => rows[headerRow].findIndex(v => norm(v) === label);
    const lines: OutboundLine[] = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      if (rows[i].some(v => norm(v) === "WHSE CODE")) break;
      if (!text(rows[i][col("MARK")]) || !text(rows[i][col("BALES")])) continue;
      lines.push({ mark: identifier(rows[i][col("MARK")], "mark"), bales: count(rows[i][col("BALES")], "bale count"),
        shippingOrder: identifier(rows[i][col("SO")], "shipping order"), warehouseCode: text(rows[i][col("WHSE")]),
        warehouse: text(rows[i][col("WAREHOUSE")]), loadBy: detailDate({ v: rows[i][col("READY DATE")] } as XlsxTypes.CellObject, "ready date")?.slice(0, 10) ?? null,
        confirmed: false, sourceRow: i + 1 });
    }
    if (!lines.length) throw Error("No Olam mark rows were found.");
    const containerText = text(field("Containers"));
    const containers = count(containerText.match(/^(\d+)\s*x\b/i)?.[1], "container count");
    const totalBales = lines.reduce((sum, l) => sum + l.bales, 0);
    const stated = rows.flat().map(text).find(v => /^TOTAL BALE COUNT:/i.test(v));
    if (stated && Number(stated.split(":")[1].trim()) !== totalBales) base.warnings.push("Olam total bale count differs from its mark rows.");
    const rampCut = date("Ramp Cut"); const portCut = date("Port Cut");
    const sourceDates = [{label: "Ramp Cut", value: rampCut}, {label: "Port Cut", value: portCut}].filter((v): v is {label:string;value:string} => !!v.value);
    const bookingNumber = bookingIdentifier(field("Booking"));
    return { ...base, sourceFormat: "olam", customer: "Olam Agri Americas Inc", bookingNumber,
      customerReference: text(field("Sale No")), containers, totalBales, lines, warehouses: [...new Set(lines.map(l => l.warehouse))],
      returnLocation: text(field("Loaded Return")), loadPort: text(field("Loaded Return")), steamshipLine: outboundSteamshipLine(text(field("S/S Line")) || text(field("Steamship Line")) || text(field("SSL")), bookingNumber), vessel: text(field("Vessel/Voyage")) || null,
      erd: date("1st Avail / ERD")?.slice(0, 10) ?? null, docCutoff: date("Doc Cut"), cutoff: rampCut ?? portCut, sourceDates,
      detailNotes: [`Olam booking reference: ${text(field("Booking Ref"))}. Equipment release: ${text(field("Equip Release"))}.`,
        "Olam source rates are reference information only; no McLeod orders or rates are created.",
        ...rows.slice(0, headerRow).flat().map(text).filter(v => /fuel|bolt seals|required|24 hours/i.test(v))] };
  }
  const c = (label: string) => rows[header].findIndex(v => text(v) === label);
  const edfScheduleOnly = !edfDispatchHeaders.every(label => c(label) >= 0);
  const data = rows.slice(header + 1).map((row, index) => ({ row, sourceRow: header + index + 2 })).filter(({row}) => row.some(v => text(v)));
  if (!data.length || data.length > 500) throw Error("ED&F export must contain between 1 and 500 load rows.");
  const one = (label: string, normalize = text) => {
    const values = [...new Set(data.map(({row}) => normalize(row[c(label)])).filter(Boolean))];
    if (values.length > 1) throw Error(`The ED&F export has multiple ${label} values. Upload one booking with consistent sailing details.`);
    return values[0] ?? "";
  };
  const rawDates = { erd: one("earliest_return_date"), docCutoff: one("document_cutoff"), cutoff: one("terminal_cutoff") };
  const year = text(options.dateYear);
  if (year && !/^(?:20\d{2}|2100)$/.test(year)) throw Error("Enter a four-digit year for the ED&F dates.");
  const parseDate = (value: string, label: string) => {
    if (!value) return null;
    const match = value.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2}):(\d{2})$/);
    if (!match) throw Error(`Unrecognized ED&F ${label}: ${value}.`);
    if (!year) return null;
    const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(match[2].toLowerCase()) + 1;
    if (!month) throw Error(`Invalid ED&F ${label}.`);
    return detailDate({v: `${year}-${String(month).padStart(2,"0")}-${match[1].padStart(2,"0")}T${match[3]}:${match[4]}`} as XlsxTypes.CellObject, label);
  };
  const seenContainers = new Set<string>();
  const lines: OutboundLine[] = data.map(({row, sourceRow}) => {
    const containerNumber = text(row[c("container_num_stuffed")]).toUpperCase();
    if (containerNumber && (!/^[A-Z]{4}\d{7}$/.test(containerNumber) || seenContainers.has(containerNumber))) throw Error(`Row ${sourceRow}: invalid or repeated container number.`);
    if (containerNumber) seenContainers.add(containerNumber);
    const supplied = options.bales?.[String(sourceRow)];
    return {mark: identifier(row[c("stuffing_reference")], "mark"), shippingOrder: "", bales: supplied === undefined || supplied === "" ? 0 : count(supplied, "bale count"),
      needsBales: true, containerNumber, warehouse: text(row[c("stuffing_place")]), warehouseCode: "", loadBy: null, confirmed: false, sourceRow};
  });
  const bookingNumber = bookingIdentifier(one("carrier_booking_number", outboundBookingNumber));
  return { ...base, sourceFormat: "edf", customer: "ED&F Man Cotton", customerNeedsConfirmation: true, warehouseNeedsConfirmation: true,
    edfScheduleOnly, needsDateYear: !edfScheduleOnly && !year, bookingNumber, customerReference: one("exporter_ref_po_number"),
    containers: lines.length, totalBales: lines.reduce((sum,l) => sum+l.bales,0), lines, warehouses: [...new Set(lines.map(l=>l.warehouse))],
    erd: parseDate(rawDates.erd,"ERD")?.slice(0,10) ?? null, docCutoff: parseDate(rawDates.docCutoff,"Doc cutoff"), cutoff: parseDate(rawDates.cutoff,"Cutoff"),
    returnLocation: [...new Set([one("full_return_place"), one("full_return_place_address")].filter(Boolean))].join(" · "),
    vessel: one("ocean_vessel_name") || null, loadPort: one("full_return_place"), steamshipLine: outboundSteamshipLine(one("ocean_carrier_name", value => outboundSteamshipLine(value)), bookingNumber),
    detailNotes: ["ED&F inland drayage layout recognized. The export does not name the customer; confirm ED&F before saving.",
      "Bale counts are missing. Enter the count for each load before saving.",
      ...(edfScheduleOnly ? [
        `Vessel schedule: ${one("ocean_pol")} to ${one("ocean_pod")} · ETD ${one("etd")} · ETA ${one("eta")}.`,
        "Enter the ERD, cutoffs, and return location if known. This export supplies vessel schedule dates and does not list the receiving warehouse.",
      ] : [`Source dates (no year or timezone supplied): ERD ${rawDates.erd}; Doc cutoff ${rawDates.docCutoff}; Cutoff ${rawDates.cutoff}. Confirm dates in warehouse local time.`,
      `Empty pickup: ${one("empty_pickup_place")}. Full return: ${one("full_return_place")}. Stuffing place: ${one("stuffing_place")}.`])] };
}

export function prepareBookingImport(booking: BookingImport, terminal: string, siteCode: string, options: BookingImportOptions = {}, saving = false) {
  if (booking.sourceFormat === "toyo" && (terminal !== "HOU" || siteCode !== "5300"))
    throw Error("Choose Houston 5300 to import a Toyo dispatch.");
  if (booking.sourceFormat === "edf") {
    if (booking.edfScheduleOnly ? terminal !== "HOU" : !["DAL", "HOU"].includes(terminal))
      throw Error(booking.edfScheduleOnly ? "Choose a Houston warehouse for this ED&F schedule export." :
        "This ED&F inland drayage layout is supported for Dallas and Houston.");
    if (saving && (!options.customerConfirmed || !options.warehouseConfirmed || booking.needsDateYear))
      throw Error(booking.edfScheduleOnly ? "Confirm ED&F and the receiving warehouse before saving." :
        "Confirm ED&F, the receiving warehouse, and the year of the source dates before saving.");
  }
  if (booking.sourceFormat === "ldc") {
    if (terminal !== "SAV") throw Error("LDC e2open exports are supported for Savannah only.");
    if (saving && !options.warehouseConfirmed) throw Error("Confirm which Savannah warehouse handled the LDC loads before saving.");
  }
  if (saving && booking.lines.some(line => !Number.isSafeInteger(line.bales) || line.bales < 1)) throw Error("Enter a positive bale count for every load before saving.");
  booking.lines = booking.sourceFormat === "ldc" || booking.sourceFormat === "edf"
    ? booking.lines.map(line => ({ ...line, warehouseCode: options.warehouseConfirmed ? siteCode : "", loadSource: "warehouse" }))
    : booking.sourceFormat === "toyo"
      ? booking.lines.map(line => ({ ...line, loadSource: "warehouse" }))
      : classifyBookingLoads(booking, terminal, siteCode);
  if (terminal === "DAL") {
    const ramp = booking.sourceDates.find(date => date.label === "Ramp Cut");
    if (ramp) { booking.cutoff = ramp.value; if (booking.docCutoff === ramp.value) booking.docCutoff = null; }
  }
  return booking;
}

export function bookingImportOptions(form: FormData): BookingImportOptions {
  let bales: Record<string, unknown> = {};
  const raw = form.get("lineBales");
  if (raw) {
    const value = JSON.parse(String(raw));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid bale count edits.");
    bales = value;
  }
  return { dateYear: String(form.get("dateYear") ?? ""), bales,
    customerConfirmed: form.get("customerConfirmed") === "true", warehouseConfirmed: form.get("warehouseConfirmed") === "true" };
}
