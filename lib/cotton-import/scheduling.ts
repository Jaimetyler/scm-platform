export type CottonSchedule = {
  location_id: string; weekday: number | null; open_time: string | null;
  close_time: string | null; checkin_cutoff: string | null;
  appointment_required: boolean | null; verified: boolean | null;
  effective_from: string | null; effective_to: string | null;
};
const clock = (v: string | null) => v && /^([01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/.test(v) ? v.slice(0,5) : null;
/** Postgres extract(dow): Sunday=0, Monday=1. No invented appointment times. */
export function scheduleForPickup(rows: readonly CottonSchedule[], locationId: string, isoDate: string) {
  const dow = new Date(isoDate + "T12:00:00Z").getUTCDay();
  const matching = rows.filter(r => r.location_id === locationId &&
    (r.weekday === dow || r.weekday === null) &&
    (!r.effective_from || r.effective_from <= isoDate) &&
    (!r.effective_to || r.effective_to >= isoDate));
  const daily = matching.filter(r => r.weekday === dow);
  const candidates = daily.length ? daily : matching;
  if (candidates.length !== 1) return { status: "review_required" as const, reason: candidates.length ? "Ambiguous location schedule" : "No schedule for pickup date", early: null, late: null };
  const row = candidates[0];
  const early = clock(row.open_time);
  const late = clock(row.checkin_cutoff) ?? clock(row.close_time);
  if (!early || !late || early > late) return { status: "review_required" as const, reason: "Missing or invalid operating window", early, late };
  if (row.verified !== true) return { status: "review_required" as const, reason: "Location hours are not verified", early, late };
  if (row.appointment_required === true) return { status: "review_required" as const, reason: "Appointment required; confirm before creation", early, late };
  return { status: "ready" as const, reason: row.checkin_cutoff ? "Check-in cutoff applied" : "Closing time applied", early, late };
}
