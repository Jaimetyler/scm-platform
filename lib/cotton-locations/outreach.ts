export const outreachStatuses = ["not_requested", "requested", "follow_up", "received", "reviewed"] as const;
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function outreachUpdate(input: Record<string, unknown>, admin: boolean) {
 if (!uuid(input.locationId) || !Number.isInteger(input.version) || Number(input.version)<0) throw Error("Refresh this facility before saving.");
 if (!outreachStatuses.includes(input.status as typeof outreachStatuses[number])) throw Error("Choose a valid status.");
 if (input.status === "reviewed" && !admin) throw Error("An administrator must review the tariff.");
 const fields = ["owner","contact_name","contact_email","contact_phone","notes"] as const;
 const changes: Record<string, unknown> = {status: input.status};
 for (const key of fields) {
  if (typeof input[key] !== "string" || String(input[key]).length > (key === "notes" ? 5000 : 250)) throw Error("Contact fields or notes are too long.");
  changes[key] = String(input[key]).trim();
 }
 for (const key of ["last_contact","next_follow_up","effective_date"] as const) {
  const v=input[key];
  if(v!==null && (typeof v!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v)) throw Error("Enter a valid date.");
  changes[key]=v;
 }
 if(typeof input.priority!=="boolean")throw Error("Invalid priority.");changes.priority=input.priority;
 return changes;
}
export const tariffBucket="cotton-tariffs";
export const maxTariffBytes=3*1024*1024;
export function tariffType(bytes: Uint8Array): {type:string;extension:string} | null {
 if(Buffer.from(bytes.subarray(0,5)).toString()==="%PDF-")return {type:"application/pdf",extension:"pdf"};
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {type:"image/jpeg",extension:"jpg"};
 if(Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {type:"image/png",extension:"png"};
 return null;
}
