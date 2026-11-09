import { warehouseDate } from "../inbound/checkin/geofence.ts";
import { warehouseWallTime } from "../inbound/checkin/mcleod-time.ts";
export function warehouseDayRange(now: Date, terminal: "SAV"|"HOU"|"DAL") {
  const day=warehouseDate(now,terminal), next=new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate()+1);
  const iso=(stamp:string)=>stamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/,"$1-$2-$3T$4:$5:$6$7");
  return {day,start:iso(warehouseWallTime(day,0,0,terminal)),end:iso(warehouseWallTime(next.toISOString().slice(0,10),0,0,terminal))};
}
