import Papa from "papaparse";
import {
  CUSTOMER_ALIASES,
  invoiceDate,
  money,
  normalize,
  type Invoice,
  type Profile,
} from "./model.ts";
export type Mapping = {
  normalized_description: string;
  tariff_id: number;
  active: boolean;
};
export type Tariff = {
  tariff_id: number;
  mcleod_code: string;
  active: boolean;
};
function matrix(csv: string): string[][] {
  if (!csv || csv.length > 2_000_000)
    throw new Error("Upload a CSV smaller than 2 MB.");
  const parsed = Papa.parse<string[]>(csv, {
    header: false,
    skipEmptyLines: true,
  });
  if (parsed.errors.length)
    throw new Error(`Invalid CSV: ${parsed.errors[0].message}`);
  return parsed.data;
}
function heading(rows: string[][], terminal: string) {
  const name = normalize(rows[0]?.[0]);
  const matches =
    terminal === "HOU"
      ? /SUPPLY CHAIN MANAGEMENT HOU/.test(name)
      : terminal === "DAL"
        ? /DALLAS/.test(name)
        : /SAVANNAH/.test(name);
  if (!matches)
    throw new Error("The report heading does not match the selected terminal.");
}
export function parseInvoices(
  summaryCSV: string,
  detailCSV: string,
  profile: Profile,
  descriptions: Mapping[],
  tariffs: Tariff[],
): Invoice[] {
  const summary = matrix(summaryCSV),
    detail = matrix(detailCSV);
  heading(summary, profile.terminal);
  heading(detail, profile.terminal);
  if (normalize(summary[0][0]) !== normalize(detail[0][0]))
    throw new Error(
      "Summary and detail reports belong to different warehouses.",
    );
  if (profile.terminal === "DAL") {
    const name = normalize(summary[0][0]);
    const expected = name.includes("(843001)")
      ? "SCMDDATX"
      : name.includes("(875260)")
        ? "SCMDDETX"
        : null;
    if (!expected || profile.location !== expected)
      throw new Error("Dallas report does not match the selected warehouse.");
  }
  const sh = summary.findIndex(
    (r) =>
      r.some((v) => normalize(v) === "MARKS") &&
      r.some((v) => normalize(v) === "SHIPPER ID"),
  );
  const dh = detail.findIndex((r) =>
    r.some((v) => normalize(v) === "SHIPPING ORDER #"),
  );
  if (sh < 0 || dh < 0)
    throw new Error(
      "Original warehouse summary and detail headers are required.",
    );
  const h = summary[sh].map(normalize),
    idx = (s: string) => h.indexOf(s);
  const mark = idx("MARKS"),
    date = idx("INVOICE DATE"),
    shipper = idx("SHIPPER ID"),
    name = idx("NAME"),
    ref = idx("ORDERS") - 1,
    amount = idx("CHARGES") - 1;
  if ([mark, date, shipper, name, ref, amount].some((i) => i < 0))
    throw new Error("Summary columns are missing.");
  const invoices = new Map<string, Invoice>();
  for (const row of summary.slice(sh + 1)) {
    if (!String(row[mark] || "").trim()) continue;
    const reference = String(row[ref] || "").trim(),
      markValue = String(row[mark]).trim();
    if (
      !reference ||
      reference.length > 28 ||
      markValue.length > 28 ||
      /[\u0000-\u001f*?]/.test(reference + markValue)
    )
      throw new Error("Invalid shipping reference or mark.");
    if (invoices.has(normalize(reference)))
      throw new Error(
        `Duplicate summary reference ${reference}; review the source report.`,
      );
    const customerName = String(row[name] || "").trim(),
      customerId = CUSTOMER_ALIASES.get(normalize(customerName));
    if (!customerId)
      throw new Error(`No approved customer mapping for ${customerName}.`);
    invoices.set(normalize(reference), {
      reference,
      mark: markValue,
      invoiceDate: invoiceDate(row[date] || ""),
      shipperId: row[shipper] || "",
      customerName,
      customerId,
      cents: money(row[amount]),
      charges: [],
    });
  }
  if (!invoices.size || invoices.size > 500)
    throw new Error("Import requires between 1 and 500 summary orders.");
  const headers = detail[dh].map(normalize),
    ri = headers.indexOf("SHIPPING ORDER #"),
    di = headers.indexOf("DESCRIPTION"),
    qi = headers.indexOf("QUANTITY"),
    ai = headers.findIndex(
      (h) => h === "TOTAL CHARGES" || h === "TOTALCHARGES",
    ),
    ti = headers.indexOf("TARIFF ID");
  if ([ri, di, qi, ai].some((i) => i < 0))
    throw new Error("Detail columns are missing.");
  const desc = new Map<string, number>();
  for (const d of descriptions.filter((x) => x.active)) {
    const k = normalize(d.normalized_description);
    if (desc.has(k) && desc.get(k) !== d.tariff_id)
      throw new Error(`Ambiguous description mapping: ${k}`);
    desc.set(k, d.tariff_id);
  }
  const tariff = new Map<number, string>();
  for (const t of tariffs.filter((x) => x.active)) {
    if (tariff.has(t.tariff_id) && tariff.get(t.tariff_id) !== t.mcleod_code)
      throw new Error(`Ambiguous tariff ${t.tariff_id}`);
    tariff.set(t.tariff_id, t.mcleod_code);
  }
  const subtotals = new Map<string, number>();
  for (const row of detail.slice(dh + 1)) {
    const reference = normalize(row[ri]);
    if (!reference) continue;
    const invoice = invoices.get(reference);
    if (!invoice)
      throw new Error(`Detail reference ${reference} is absent from summary.`);
    const description = String(row[di] || "").trim();
    if (!description) {
      if (String(row[ai] || "").trim())
        subtotals.set(reference, money(row[ai]));
      continue;
    }
    const tariffId =
      ti >= 0 && /^\d+$/.test(String(row[ti] || "").trim())
        ? Number(row[ti])
        : desc.get(normalize(description));
    const code = tariff.get(tariffId);
    if (!code)
      throw new Error(`Unmapped charge on ${reference}: ${description}`);
    const quantity = String(row[qi] || "")
      .replace(/,/g, "")
      .trim();
    if (
      !/^\d+(?:\.\d+)?$/.test(quantity) ||
      !Number.isFinite(+quantity) ||
      +quantity <= 0
    )
      throw new Error(`Invalid quantity for ${reference}: ${description}`);
    invoice.charges.push({
      code,
      description,
      units: +quantity,
      cents: money(row[ai]),
    });
  }
  for (const invoice of invoices.values()) {
    const cents = invoice.charges.reduce((sum, c) => sum + c.cents, 0);
    if (
      !invoice.charges.length ||
      cents !== invoice.cents ||
      !subtotals.has(normalize(invoice.reference)) ||
      subtotals.get(normalize(invoice.reference)) !== cents
    )
      throw new Error(
        `Invoice/detail total mismatch for ${invoice.reference}.`,
      );
  }
  const total = [...invoices.values()].reduce((sum, r) => sum + r.cents, 0);
  for (const [rows, col] of [
    [summary, idx("CHARGES")],
    [detail, ai],
  ] as [string[][], number][]) {
    const last = rows.at(-1);
    if (!last || !String(last[col] || "").trim() || money(last[col]) !== total)
      throw new Error("Report grand total does not match order totals.");
  }
  return [...invoices.values()];
}
