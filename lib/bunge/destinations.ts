// Destination codes observed in MAIN / DAVIS order history, not eCotton handling profiles.
// MAIN: Pasted text(116).txt (2026-05-21 order extract). DAVIS: CottonLocationHistoryTx.csv.
// Current names, addresses and active status are fetched from McLeod before selection/preview.
export const SCM_DELIVERY_LOCATIONS=[
 {code:"SAVAGAG2",label:"Savannah — Bourne Avenue (default)"},
 {code:"SUPPSAG2",label:"Savannah"},
 {code:"SUPPBAT1",label:"Houston area — Baytown"},
 {code:"SUPPPAT1",label:"Houston area — Pasadena"},
 {code:"SCMDDETX",label:"Dallas area — DeSoto"},
 {code:"SCMDDATX",label:"Dallas"},
 {code:"SUPPLAT1",label:"Dallas area — Lancaster"},
 {code:"SUPPHUTX",label:"Dallas area — Hutchins"},
 {code:"SUPPDATX",label:"Dallas"},
 {code:"SCM7ARTX",label:"Dallas area"},
] as const;
export const DEFAULT_BUNGE_DELIVERY="SAVAGAG2";
export function deliveryCode(value:unknown):string{
 const code=value==null||value===""?DEFAULT_BUNGE_DELIVERY:String(value);
 if(!SCM_DELIVERY_LOCATIONS.some(l=>l.code===code))throw Error("Choose an SCM delivery location.");return code;
}
export type DeliveryLocation={code:string;name:string;address:string;address2:string;city:string;state:string;zip:string};
