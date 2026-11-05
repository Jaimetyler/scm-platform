import test from "node:test";
import assert from "node:assert/strict";
import { draftPickupNotes } from "../lib/cotton-import/pickup-notes.ts";

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
