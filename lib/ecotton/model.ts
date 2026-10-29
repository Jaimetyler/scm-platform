export type Terminal = "HOU" | "DAL" | "SAV";
export type Profile = {
  id: string;
  terminal: Terminal;
  label: string;
  location: string;
  revenue: string;
  orderType: string;
  orderedBy: string;
  commodity: string;
  equipment: string;
  mode: string;
  payee: string;
  timezone: string;
  confirmed: boolean;
};
export type Charge = {
  code: string;
  description: string;
  units: number;
  cents: number;
};
export type Invoice = {
  reference: string;
  mark: string;
  invoiceDate: string;
  shipperId: string;
  customerName: string;
  customerId: string;
  cents: number;
  charges: Charge[];
};
export const normalize = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
export const PROFILES: Profile[] = [
  {
    id: "HOU-HOUWHSE",
    terminal: "HOU",
    label: "Houston — HOUWHSE",
    location: "HOUWHSE",
    revenue: "HLOCA",
    orderType: "ECOTTON",
    orderedBy: "ECOTTON",
    commodity: "COTTON",
    equipment: "C",
    mode: "T",
    payee: "SCMIRIGA",
    timezone: "America/New_York",
    confirmed: true,
  },
  // Defaults cross-checked against existing ECOTTON orders at both Dallas warehouses.
  ...["SCMDDETX", "SCMDDATX"].map((location) => ({
    id: `DAL-${location}`,
    terminal: "DAL" as const,
    label: `Dallas — ${location}`,
    location,
    revenue: "DLOCA",
    orderType: "ECOTTON",
    orderedBy: "ECOTTON",
    commodity: "COTTON",
    equipment: "C",
    mode: "T",
    payee: "SCMIRIGA",
    timezone: "America/New_York",
    confirmed: true,
  })),
  // Both local Savannah locations are present in existing ECOTTON orders.
  ...["SAVWHSE", "SUPPRIG2"].map((location) => ({
    id: `SAV-${location}`,
    terminal: "SAV" as const,
    label: `Savannah — ${location}`,
    location,
    revenue: "LOCAL",
    orderType: "ECOTTON",
    orderedBy: "ECOTTON",
    commodity: "COTTON",
    equipment: "C",
    mode: "T",
    payee: "SCMIRIGA",
    timezone: "America/New_York",
    confirmed: true,
  })),
];
const aliases: [string, string][] = [
  ["ADM COTTON", "ADMCLUT1"],
  ["Baco Trading, Inc.", "BACOMCTX"],
  ["COFCO Americans Resources Corp", "COFCMETN"],
  ["Olam Cotton", "OLAMRIT1"],
  ["Stapl", "STAPGRM1"],
  ["Viterra USA Agriculture LLC", "BUNGECNE"],
  ["Louis Dreyfus Company Cotton", "LDCACOTN"],
  ["MEMTEX Cotton Marketing", "MEMTLUTX"],
  ["Ecom USA, Inc", "ECOMDAT1"],
  ["ECOM USA LLC", "ECOMDAT1"],
  ["Hang Tung Resources (USA)", "HANGGLI1"],
  ["Viterra USA Agriculture", "BUNGECNE"],
  ["Colly Commodities Inc.", "COLLPLT1"],
  ["Toyo Cotton", "TOYODAT1"],
  ["OMNICOTTON, INC.", "OMNIECTX"],
  ["TERRA NOVA COMMODITIES, LLC", "TERRECTX"],
  ["Cargill Cotton", "CARGECKS"],
  ["White Gold Cotton Marketing", "WHITECCA"],
  ["Bunge USA Agriculture, LLC.", "BUNGECNE"],
  ["Goetz & Sons, Inc.", "GOETECTX"],
  ["Hang Tung Resources (USA) Co.,", "HANGGLI1"],
  ["Bunge", "BUNGECNE"],
  ["Bunge USA Agriculture LLC", "BUNGECNE"],
  ["Bunge USA Agriculture, LLC", "BUNGECNE"],
  ["ED&F MAN COTTON", "EDFMECTX"],
  ["Olam/Brightfield Cotton", "OLAMRIT1"],
  ["TERRA NOVA", "TERRECTX"],
];
export const CUSTOMER_ALIASES = new Map(
  aliases.map(([name, id]) => [normalize(name), id]),
);
export function money(value: unknown): number {
  const s = String(value ?? "")
    .trim()
    .replace(/[$,]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s))
    throw new Error(`Invalid monetary amount: ${String(value).slice(0, 60)}`);
  const [whole, fraction = ""] = s.replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents))
    throw new Error("Invoice amount is too large.");
  return s.startsWith("-") ? -cents : cents;
}
export function invoiceDate(value: string): string {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`Invalid invoice date: ${value}`);
  const month = +m[1],
    day = +m[2],
    year = +m[3];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    year > 2100 ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    throw new Error(`Invalid invoice date: ${value}`);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
