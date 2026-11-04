export type PickupMonthRange={from:string;to:string};
function validDate(value:unknown):string{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error("A valid scheduled pickup date is required for the duplicate check.");
 const d=new Date(value+"T12:00:00Z");if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw Error("A valid scheduled pickup date is required for the duplicate check.");return value;
}
function shiftMonth(value:string,delta:number){
 const [y,m,day]=value.split("-").map(Number);const month=new Date(Date.UTC(y,m-1+delta,1));const last=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();month.setUTCDate(Math.min(day,last));return month.toISOString().slice(0,10);
}
export function pickupMonthRanges(values:unknown):PickupMonthRange[]{
 if(!Array.isArray(values)||!values.length||values.length>2)throw Error("Scheduled pickup dates are required (up to two pickup stops).");
 const ranges=[...new Set(values.map(validDate))].map(d=>({from:shiftMonth(d,-1),to:shiftMonth(d,1)})).sort((a,b)=>a.from.localeCompare(b.from));
 const merged:PickupMonthRange[]=[];for(const r of ranges){const previous=merged[merged.length-1];if(previous&&r.from<=previous.to)previous.to=previous.to>r.to?previous.to:r.to;else merged.push({...r})}return merged;
}
export function scheduledPickupDay(value:unknown):string{
 if(typeof value!=="string")throw Error("Cannot verify the existing order’s scheduled pickup date.");
 const match=value.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T|\d|\s|$)/);
 if(!match)throw Error("Cannot verify the existing order’s scheduled pickup date.");return validDate(`${match[1]}-${match[2]}-${match[3]}`);
}
