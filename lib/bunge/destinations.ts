// SCM locations already used by the platform, plus the agreed Bunge Savannah default.
export const SCM_DELIVERY_LOCATIONS=[
 {code:"SAVAGAG2",label:"Savannah — Bourne Avenue (default)"},
 {code:"SAVWHSE",label:"Savannah — SAVWHSE"},
 {code:"SUPPRIG2",label:"Savannah — SUPPRIG2"},
 {code:"HOUWHSE",label:"Houston — HOUWHSE"},
 {code:"SCMDDETX",label:"Dallas — SCMDDETX"},
 {code:"SCMDDATX",label:"Dallas — SCMDDATX"},
] as const;
export const DEFAULT_BUNGE_DELIVERY="SAVAGAG2";
export function deliveryCode(value:unknown):string{
 const code=value==null||value===""?DEFAULT_BUNGE_DELIVERY:String(value);
 if(!SCM_DELIVERY_LOCATIONS.some(l=>l.code===code))throw Error("Choose an SCM delivery location.");return code;
}
export type DeliveryLocation={code:string;name:string;address:string;address2:string;city:string;state:string;zip:string};
