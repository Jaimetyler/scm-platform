import test from "node:test";
import assert from "node:assert/strict";
import { draftPickupNotes, pickupLastFreeDates } from "../lib/cotton-import/pickup-notes.ts";

test("dispatch notes keep separate pickup policies, effective dates and draft status", () => {
  const pickups = [
    { locationId: "gulf", locationCode: "GULFCOT2", scheduledDate: "2026-11-10" },
    { locationId: "united", locationCode: "UNITELTX", scheduledDate: "2026-11-11" },
  ];
  const late = { rule_kind: "late_pickup", fee_type: "PER_BALE_PER_DAY", amount: .5, grace_days: 3, grace_unit: "CALENDAR_DAYS" };
  const early = { rule_kind: "early_pickup", fee_type: "PER_BALE_ONE_TIME", amount: 1.5, notes: "Contact the warehouse." };
  const [first, second] = draftPickupNotes(pickups, new Map([
    ["gulf", [
      { status: "draft", effective_from: "2026-11-01", effective_to: null, rules: [late, early] },
      { status: "draft", effective_from: "2026-12-01", effective_to: null, rules: [late] },
    ]],
  ]));
  assert.equal(first.type, "Dispatch comment");
  assert.match(first.comment, /Late pickup \[draft\]: \$0\.50 per bale per day; grace: 3 calendar days/);
  assert.match(first.comment, /Early pickup \[draft\]: \$1\.50 per bale, one time\. Contact the warehouse/);
  assert.equal(second.stopSequence, 2);
  assert.match(second.comment, /Early pickup: policy not on file/);
});

test("pickup last free day uses the effective approved late-fee rule", () => {
  const pickup = { locationId: "gulf", locationCode: "GULFPOTX", scheduledDate: "2026-11-25" };
  const rule = {
    rule_kind: "late_pickup", fee_type: "PER_BALE_PER_DAY",
    amount: 0.5, grace_days: 3, grace_unit: "calendar_days", notes: null,
  };
  const approved = { status: "approved", effective_from: "2026-07-01", effective_to: null, rules: [rule] };
  const datesFor = (...versions) => pickupLastFreeDates([pickup], new Map([["gulf", versions]]));

  assert.deepEqual(datesFor(approved), ["2026-11-28"]);
  assert.deepEqual(datesFor({ ...approved, status: "draft" }), [null]);
  assert.deepEqual(datesFor({ ...approved, effective_from: "2026-11-26" }), [null]);
  assert.deepEqual(datesFor({ ...approved, rules: [{ ...rule, grace_days: 0 }] }), ["2026-11-25"]);
  assert.deepEqual(datesFor({ ...approved, rules: [{ ...rule, grace_unit: "business_days" }] }), ["2026-12-01"]);
});
