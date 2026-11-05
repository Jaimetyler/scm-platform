import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const mod={exports:{}};
const js=ts.transpileModule(readFileSync("lib/cotton-import/scheduling.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function("module","exports",js)(mod,mod.exports);
const {scheduleForPickup}=mod.exports;
const base={location_id:"loc1",weekday:4,open_time:"08:00:00",close_time:"16:30:00",checkin_cutoff:"15:00:00",appointment_required:false,verified:true,effective_from:null,effective_to:null};
test("check-in cutoff takes priority over closing time",()=>{
 const w=scheduleForPickup([base],"loc1","2026-11-05");
 assert.equal(w.status,"ready");assert.equal(w.early,"08:00");assert.equal(w.late,"15:00");
});
test("closing time is fallback without cutoff",()=>{
 assert.equal(scheduleForPickup([{...base,checkin_cutoff:null}],"loc1","2026-11-05").late,"16:30");
});
test("missing, unverified and appointment-required schedules require review",()=>{
 assert.equal(scheduleForPickup([],"loc1","2026-11-05").status,"review_required");
 assert.equal(scheduleForPickup([{...base,verified:false}],"loc1","2026-11-05").status,"review_required");
 assert.equal(scheduleForPickup([{...base,appointment_required:true}],"loc1","2026-11-05").status,"review_required");
});
