import { CUSTOMER_ALIASES, PROFILES, invoiceDate, money, normalize, type Invoice, type Profile } from "./model.ts";
import type { Tariff } from "./parse.ts";

const warehouseProfiles = new Map([
  ["266861", "SAV-SAVWHSE"],
  ["875260", "DAL-SCMDDETX"],
  ["843001", "DAL-SCMDDATX"],
]);

export function ginDirectProfile(pages: unknown): Profile {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 100)
    throw new Error("Upload between 1 and 100 Gin Direct invoice pages.");
  const profiles = pages.map((page, index) => {
    if (typeof page !== "string" || page.length > 16000)
      throw new Error(`Invalid invoice text on page ${index + 1}.`);
    const header = page.split(/\bBill\s+To\s*:/i)[0];
    const warehouseId = header.match(/\bWarehouse\s+ID\s*:\s*(\d+)\b/i)?.[1];
    const terminal = /\bSAV(?:ANNAH)?[-\s]/i.test(header) ? "SAV"
      : /\bDALLAS\b/i.test(header) ? "DAL"
      : /\bHOU(?:STON)?\b/i.test(header) ? "HOU" : null;
    const id = warehouseProfiles.get(warehouseId);
    const profile = PROFILES.find((p) => p.id === id && p.terminal === terminal);
    if (!profile || (warehouseId === "266861" && !/\b1601\s+Old\s+Augusta\b/i.test(header)))
      throw new Error(`Page ${index + 1}: warehouse ${warehouseId ?? "ID unreadable"} has no confirmed Gin Direct location for this heading.`);
    return profile;
  });
  if (profiles.some((p) => p.id !== profiles[0].id))
    throw new Error("Upload Gin Direct invoices for one warehouse per run.");
  return { ...profiles[0], label: `Gin Direct · ${profiles[0].label}`, orderedBy: "GIN DIRECT" };
}

const amount = String.raw`-?\$?\d[\d,]*\.\d{2}`;
const chargeLine = new RegExp(String.raw`^(\d{1,6})\s+(.+?)\s+(\d[\d,]*(?:\.\d+)?)\s+(${amount})\s+(${amount})$`);

export function parseGinDirectInvoices(pages: string[], tariffs: Tariff[]): Invoice[] {
  const codes = new Map<number, string>();
  for (const tariff of tariffs.filter((t) => t.active)) {
    if (codes.has(tariff.tariff_id) && codes.get(tariff.tariff_id) !== tariff.mcleod_code)
      throw new Error(`Ambiguous tariff ${tariff.tariff_id}.`);
    codes.set(tariff.tariff_id, tariff.mcleod_code);
  }
  const seen = new Set<string>();
  return pages.map((page, index) => {
    try {
      const lines = page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const table = lines.findIndex((line) => /^Tariff\s+ID\s+Description\s+Quantity\s+Rate\s+Total$/i.test(line));
      const billTo = lines.findIndex((line) => /^Bill\s+To\s*:/i.test(line));
      const footer = lines.findIndex((line) => /^Total\s+Invoice\s+Amount\b/i.test(line));
      if (!/\bService\s+Invoice\b/i.test(page) || billTo < 0 || table <= billTo || footer <= table)
        throw new Error("Could not read the invoice heading, Bill To, charge table, or printed total.");
      const header = lines.slice(0, billTo).join(" ");
      const reference = header.match(/\bInvoice\s*#\s*:\s*([A-Za-z0-9-]{1,28})(?=\s|$)/i)?.[1];
      const date = header.match(/\bInvoice\s+Date\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})(?=\s|$)/i)?.[1];
      const warehouseId = header.match(/\bWarehouse\s+ID\s*:\s*(\d+)\b/i)?.[1];
      if (!reference || !date || !warehouseId) throw new Error("Could not read invoice number, date, or warehouse ID.");
      if (seen.has(normalize(reference))) throw new Error(`Duplicate invoice number ${reference} in this upload.`);
      seen.add(normalize(reference));
      const customerName = lines[billTo].replace(/^Bill\s+To\s*:\s*/i, "") || lines[billTo + 1];
      const customerKey = normalize(customerName).replace(/\s*[-–—]\s*(?=ACCOUNT OF BEARER$)/, "-");
      const customerId = CUSTOMER_ALIASES.get(customerKey) ??
        CUSTOMER_ALIASES.get(customerKey.replace(/-ACCOUNT OF BEARER$/, ""));
      if (!customerId) throw new Error(`No approved customer mapping for ${customerName}.`);
      const cents = money(lines[footer].replace(/^Total\s+Invoice\s+Amount\s*:?\s*/i, ""));
      const unpostedZeroTariffs: { tariffId: string; description: string; units: number }[] = [];
      const charges = lines.slice(table + 1, footer).flatMap((line) => {
        const fields = line.match(chargeLine);
        if (!fields) throw new Error(`Could not read charge line: ${line}`);
        const [, tariff, description, quantity, rate, total] = fields;
        const units = Number(quantity.replaceAll(",", ""));
        const lineCents = money(total);
        if (!Number.isFinite(units) || units <= 0 || Math.round(units * money(rate)) !== lineCents)
          throw new Error(`Quantity × rate does not match tariff ${tariff} total.`);
        const code = codes.get(Number(tariff));
        if (!code) {
          if (lineCents !== 0) throw new Error(`Unmapped tariff ${tariff}: ${description}`);
          unpostedZeroTariffs.push({ tariffId: tariff, description, units });
          return [];
        }
        return [{ code, description, units, cents: lineCents }];
      });
      if (!(charges.length || unpostedZeroTariffs.length) || charges.reduce((sum, charge) => sum + charge.cents, 0) !== cents)
        throw new Error("Charge totals do not match the printed invoice total.");
      const isoDate = invoiceDate(date);
      return { reference, mark: isoDate.replaceAll("-", ""), invoiceDate: isoDate, shipperId: "", warehouseId, customerName, customerId, cents, charges, unpostedZeroTariffs };
    } catch (error) {
      throw new Error(`Gin Direct page ${index + 1}: ${(error as Error).message}`);
    }
  });
}
