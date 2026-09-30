export type DashboardBooking = {
  id: string; booking_number: string; terminal: string; site_code: string; site_name: string; customer: string;
  customer_reference: string | null; requested_bales: number; planned_containers: number | null; status: string;
  erd: string | null; doc_cutoff: string | null; cutoff: string | null; vessel: string | null;
  doc_cutoff_has_time: boolean; cutoff_has_time: boolean;
};
export type DeadlineView = "all" | "today" | "upcoming" | "past";
export type BookingGroup = "schedule" | "customer" | "vessel";

export function warehouseNow(terminal: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: terminal === "HOU" ? "America/Chicago" : "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function deadlines(booking: DashboardBooking) {
  return [{ value: booking.doc_cutoff, hasTime: booking.doc_cutoff_has_time }, { value: booking.cutoff, hasTime: booking.cutoff_has_time }]
    .filter((item) => Boolean(item.value));
}
export function deadlineMatches(booking: DashboardBooking, view: DeadlineView, now = new Date()) {
  if (view === "all") return true;
  const local = warehouseNow(booking.terminal, now);
  const today = local.slice(0, 10);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return deadlines(booking).some(({ value, hasTime }) => {
    const date = value!.slice(0, 10);
    if (view === "today") return date === today;
    if (view === "past") return date < today || (hasTime !== false && date === today && value!.replace(" ", "T").slice(0, 16) < local);
    return date > today && date <= end.toISOString().slice(0, 10);
  });
}
export function bookingSchedule(booking: DashboardBooking, now = new Date()) {
  if (deadlineMatches(booking, "today", now)) return "Today";
  if (deadlineMatches(booking, "past", now)) return "Past cutoff";
  return deadlines(booking).length ? "Upcoming" : "Dates needed";
}
export function groupBookings(bookings: DashboardBooking[], group: BookingGroup, now = new Date()) {
  const result = new Map<string, DashboardBooking[]>();
  for (const booking of bookings) {
    const key = group === "customer" ? booking.customer || "Customer needed" : group === "vessel" ? booking.vessel || "Vessel needed" : bookingSchedule(booking, now);
    result.set(key, [...(result.get(key) ?? []), booking]);
  }
  const order = ["Today", "Upcoming", "Past cutoff", "Dates needed"];
  return [...result].sort(([a], [b]) => group === "schedule" ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b));
}
