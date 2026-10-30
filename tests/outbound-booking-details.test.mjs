import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBookingDetails, bookingDateInput, formatBookingDate } from "../lib/warehouse/outbound/details.ts";

test("booking details retain warehouse-local cutoff times and allow clearing fields", () => {
  assert.deepEqual(normalizeBookingDetails({ erd: "2026-10-01", docCutoff: "2026-10-03T16:00", cutoff: "2026-10-04T17:30", vessel: "  MSC TEST  " }), {
    erd: "2026-10-01", doc_cutoff: "2026-10-03T16:00", doc_cutoff_has_time: true, cutoff: "2026-10-04T17:30", cutoff_has_time: true, vessel: "MSC TEST",
  });
  assert.deepEqual(normalizeBookingDetails({ erd: "", docCutoff: "", cutoff: "", vessel: " " }), {
    erd: null, doc_cutoff: null, doc_cutoff_has_time: false, cutoff: null, cutoff_has_time: false, vessel: null,
  });
  assert.equal(bookingDateInput("2026-10-03T16:00:00", true), "2026-10-03T16:00");
  assert.equal(formatBookingDate("2026-10-03T16:00:00", true), "Oct 3, 2026, 4:00 PM");
  assert.equal(formatBookingDate(null), "—");
});

test("booking details reject invalid dates and cutoff timezones", () => {
  for (const values of [{ erd: "2026-02-30" }, { docCutoff: "2026-10-03T25:00" }, { cutoff: "2026-10-04T17:30Z" }, { cutoff: "2026-10-04T17:30-04:00" }, { vessel: "x".repeat(201) }])
    assert.throws(() => normalizeBookingDetails(values));
});

test("date-only cutoffs retain unknown time instead of displaying midnight", () => {
  const values = normalizeBookingDetails({ docCutoff: "2026-09-16", cutoff: "2026-09-18" });
  assert.equal(values.doc_cutoff, "2026-09-16T00:00");
  assert.equal(values.doc_cutoff_has_time, false);
  assert.equal(values.cutoff_has_time, false);
  assert.equal(formatBookingDate(values.doc_cutoff, values.doc_cutoff_has_time), "Sep 16, 2026");
  assert.equal(bookingDateInput(values.doc_cutoff, values.doc_cutoff_has_time), "2026-09-16");
});
