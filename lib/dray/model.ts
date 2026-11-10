import type { Invoice, Profile } from "../ecotton/model.ts";
export { money, normalize, invoiceDate } from "../ecotton/model.ts";
export type DrayInvoice = Invoice & {
  customerOrder?: string;
  sourceKey: string; shippingOrder: string; container: string; chassis: string;
  seal: string; fileNumber: string; booking: string; steamship: string;
  destination: string; baseCents: number; carrierCents: number | null;
  firstStarLoad: string | null; inputErrors: string[];
};
// Rates are warehouse-scoped. Dallas and Houston deliberately have no active rules.
export const PROFILE: Profile = {
  id: "DRAY-SAV-SAVWHSE", terminal: "SAV", label: "Savannah — warehouse drays",
  location: "SAVWHSE", revenue: "LOCAL", orderType: "FLAT", orderedBy: "",
  commodity: "COTTON", equipment: "C", mode: "T", payee: "SCMIRIGA",
  timezone: "America/New_York", confirmed: true,
};
export type CustomerRate = { name: string; code: string; aliases: string[]; port: number; ocean: number; chassis: number };
export const SAVANNAH_RATES: CustomerRate[] = [
  {name:"Louis Dreyfus / Allenberg",code:"ALLELOTN",aliases:["Louis Dreyfus Company Cotton","Allenberg Cotton Co."],port:35000,ocean:35000,chassis:13500},
  {name:"Olam Cotton",code:"OLAMRITX",aliases:["Olam Cotton","Olam/Brightfield Cotton"],port:32500,ocean:45000,chassis:9000},
  {name:"Staplcotn",code:"STAPLOMS",aliases:["Stapl","Staplcotn","STAPLCOTN CO OP ASSN"],port:35000,ocean:47500,chassis:13500},
  {name:"Ecom USA",code:"ECOMLOTX",aliases:["Ecom USA, Inc","ECOM USA INC","ECOM USA LLC"],port:35000,ocean:47500,chassis:13500},
  {name:"Bunge",code:"BUNGOMNE",aliases:["Bunge","Bunge USA Agriculture LLC","Bunge USA Agriculture LLC.","Bunge USA Agriculture, LLC","Bunge USA Agriculture, LLC.","Viterra USA Agriculture LLC"],port:35000,ocean:40500,chassis:13500},
  {name:"Baco Trading",code:"BACOMCTX",aliases:["Baco Trading","Baco Trading, Inc."],port:35000,ocean:47500,chassis:13500},
  {name:"ADM Cotton",code:"ADMCLOTX",aliases:["ADM Cotton"],port:35000,ocean:47500,chassis:13500},
  {name:"Omni Cotton",code:"OMNILOTX",aliases:["OMNI Cotton","OMNICOTTON, INC."],port:35000,ocean:47500,chassis:13500},
  {name:"Toyo Cotton",code:"TOYOLOTX",aliases:["Toyo Cotton","Toyo Cotton Company"],port:35000,ocean:47500,chassis:13500},
  {name:"COFCO Americas",code:"NOBLHOTX",aliases:["COFCO Americas Resources Corp.","COFCO Americans Resources Corp","COFCO Americas Resources Corp"],port:35000,ocean:40500,chassis:13500},
];

