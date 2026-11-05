// Destination codes observed in MAIN / DAVIS order history, not eCotton handling profiles.
// MAIN: Pasted text(116).txt (2026-05-21 order extract). DAVIS: CottonLocationHistoryTx.csv.
// Current names, addresses and active status are fetched from McLeod before selection/preview.
export const SCM_DELIVERY_LOCATIONS=[
 {terminal:"savannah",code:"SAVAGAG2",label:"Savannah — Bourne Avenue (default)"},
 {terminal:"savannah",code:"SUPPSAG2",label:"Savannah"},
 {terminal:"houston",code:"SUPPBAT1",label:"Houston area — Baytown"},
 {terminal:"houston",code:"SUPPPAT1",label:"Houston area — Pasadena"},
 {terminal:"dallas",code:"SCMDDETX",label:"Dallas area — DeSoto"},
 {terminal:"dallas",code:"SCMDDATX",label:"Dallas"},
 {terminal:"dallas",code:"SUPPLAT1",label:"Dallas area — Lancaster"},
 {terminal:"dallas",code:"SUPPHUTX",label:"Dallas area — Hutchins"},
 {terminal:"dallas",code:"SUPPDATX",label:"Dallas"},
 {terminal:"dallas",code:"SCM7ARTX",label:"Dallas area"},
] as const;
export const DEFAULT_BUNGE_DELIVERY="SAVAGAG2";
export function deliveryCode(value:unknown):string{
 const code=value==null||value===""?DEFAULT_BUNGE_DELIVERY:String(value);
 if(!SCM_DELIVERY_LOCATIONS.some(l=>l.code===code))throw Error("Choose an SCM delivery location.");return code;
}
export function scmReceivingHours(code: string) {
 const location = SCM_DELIVERY_LOCATIONS.find(entry => entry.code === code);
 if (!location) throw Error("Choose an SCM delivery location.");
 return { open: "07:00", close: code === "SUPPBAT1" ? "20:00" : "15:00",
  method: "FCFS" as const, timezone: location.terminal === "savannah" ? "America/New_York" : "America/Chicago" };
}

export type DeliveryLocation={code:string;name:string;address:string;address2:string;city:string;state:string;zip:string;
 receivingHours: ReturnType<typeof scmReceivingHours>};

export const inboundTerminals = [
 { id: "savannah", label: "Savannah", revenue: "MAIN" },
 { id: "dallas", label: "Dallas", revenue: "DAVIS" },
 { id: "houston", label: "Houston", revenue: "MAIN" },
] as const;
export type InboundTerminal = typeof inboundTerminals[number]["id"];

export function terminalDeliveryCode(terminal: InboundTerminal, value: unknown): string {
 const options = SCM_DELIVERY_LOCATIONS.filter(location => location.terminal === terminal);
 const code = value == null ? options[0].code : value;
 if (!options.some(location => location.code === code)) throw Error("Choose a delivery location in the selected inbound region.");
 return String(code);
}

export function inboundTerminal(value: unknown) {
 return inboundTerminals.find(terminal => terminal.id === value);
}
