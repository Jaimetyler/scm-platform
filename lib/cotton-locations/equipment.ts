export const equipmentChoices=["unknown","van_only","van_and_flatbed"] as const;
export const feeBases=["unknown","none","per_load","per_bale","other"] as const;
export type EquipmentPolicy={location_id:string;accepted_equipment:string;fee_basis:string;fee_amount:number|null;fee_payer:string;conditions:string;source_reference:string;effective_date:string|null;verified:boolean;version:number};
export function validateEquipment(input:Record<string,unknown>,admin:boolean){
 if(!equipmentChoices.includes(input.accepted_equipment as any)||!feeBases.includes(input.fee_basis as any))throw Error("Choose valid equipment and fee basis values.");
 const amount=input.fee_amount;if(amount!==null&&(typeof amount!=="number"||!Number.isFinite(amount)||amount<0||amount>100000))throw Error("Enter a valid flatbed fee.");
 if(["per_load","per_bale"].includes(String(input.fee_basis))&&amount===null)throw Error("Enter the flatbed fee amount.");
 if(input.fee_basis==="unknown"&&amount!==null)throw Error("Choose the fee basis before entering an amount.");
 if(input.fee_basis==="none"&&amount!==null&&amount!==0)throw Error("A no-charge fee must be zero.");
 if(typeof input.conditions!=="string"||input.conditions.length>2000||typeof input.source_reference!=="string"||!input.source_reference.trim()||input.source_reference.length>1000)throw Error("Source is required; conditions must be under 2,000 characters.");
 const date=input.effective_date;if(date!==null&&(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error("Enter a valid effective date.");
 if(typeof input.verified!=="boolean"||input.verified&&!admin)throw Error("Only an administrator can confirm equipment policies.");
 if(input.verified&&(input.accepted_equipment==="unknown"||input.accepted_equipment==="van_and_flatbed"&&(input.fee_basis==="unknown")))throw Error("Confirm accepted equipment and flatbed fee before marking verified.");
 return {accepted_equipment:input.accepted_equipment,fee_basis:input.fee_basis,fee_amount:input.fee_basis==="none"?0:amount,fee_payer:"shipper",conditions:input.conditions.trim(),source_reference:input.source_reference.trim(),effective_date:date,verified:input.verified};
}
export function equipmentNotes(policy:EquipmentPolicy|undefined,requested:string,state:string|null):string[]{
 const priority=["TX","OK","KS","NM"].includes(state||"");const notes:string[]=[];
 if(requested==="unknown"&&priority)notes.push("Confirm van/flatbed equipment and loading restrictions.");
 if(requested!=="flatbed"&&requested!=="VT")return notes;
 if(!policy||policy.accepted_equipment==="unknown")notes.push("Flatbed acceptance is unknown; confirm before booking.");
 else if(policy.accepted_equipment==="van_only")notes.push(`VAN ONLY: flatbed pickup conflicts with recorded restriction${policy.verified?"":" (unverified; confirm with facility)"}.`);
 if(policy?.fee_basis==="none")notes.push("No flatbed fee recorded"+(policy.verified?".":" — unverified."));
 else if(policy?.fee_amount!=null){notes.push(`Flatbed fee: $${Number(policy.fee_amount).toFixed(2)} ${policy.fee_basis.replaceAll("_"," ")}; payer: ${policy.fee_payer}. ${policy.verified?"Confirmed":"Unverified"}. Not added to carrier pay or order charges.`);}
 else notes.push("Flatbed fee is unknown; request current tariff and payer confirmation.");
 if(policy?.conditions)notes.push("Equipment conditions: "+policy.conditions);
 return notes;
}
