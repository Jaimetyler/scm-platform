// Cutoffs are warehouse-local wall times; never shift them through UTC in the page.
function dateValue(value: unknown, label: string, withTime = false) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be a valid date${withTime ? " and time" : ""}.`);
  const text = value.trim();
  const pattern = withTime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/ : /^\d{4}-\d{2}-\d{2}$/;
  const date = new Date(`${text}${withTime ? "" : "T00:00:00"}Z`);
  if (!pattern.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, withTime ? 16 : 10) !== text.slice(0, withTime ? 16 : 10))
    throw new Error(`${label} must be a valid date${withTime ? " and time" : ""}.`);
  return text;
}

export function normalizeBookingDetails(body: Record<string, unknown>) {
  if (body.vessel != null && typeof body.vessel !== "string") throw new Error("Enter a vessel name.");
  const vessel = String(body.vessel ?? "").trim();
  if (vessel.length > 200) throw new Error("Vessel must be 200 characters or fewer.");
  function cutoffValue(value: unknown, label: string) {
    const hasTime = typeof value === "string" && value.includes("T");
    const parsed = dateValue(value, label, hasTime);
    return { value: parsed && !hasTime ? `${parsed}T00:00` : parsed, hasTime };
  }
  const doc = cutoffValue(body.docCutoff, "Doc cutoff");
  const cargo = cutoffValue(body.cutoff, "Cutoff");
  if (body.scmFileNumber !== undefined && (typeof body.scmFileNumber !== "string" || body.scmFileNumber.trim().length > 80))
    throw new Error("SCM File # must be 80 characters or fewer.");
  return { ...(body.scmFileNumber !== undefined ? { scm_file_number: String(body.scmFileNumber).trim() || null } : {}), erd: dateValue(body.erd, "ERD"), doc_cutoff: doc.value, doc_cutoff_has_time: doc.hasTime,
    cutoff: cargo.value, cutoff_has_time: cargo.hasTime, vessel: vessel || null };
}

export function bookingDateInput(value: string | null | undefined, withTime = false) {
  return value ? value.replace(" ", "T").slice(0, withTime ? 16 : 10) : "";
}

export function formatBookingDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  // Parse as UTC only for formatting these date components; display exactly the saved wall time.
  const date = new Date(`${bookingDateInput(value, withTime)}${withTime ? "" : "T00:00"}Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(date);
}
