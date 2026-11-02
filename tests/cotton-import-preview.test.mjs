import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
const cache = new Map();
function load(file) {
 const path=resolve(file); if(cache.has(path)) return cache.get(path).exports;
 const mod={exports:{}};cache.set(path,mod);
 const code=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function("require","module","exports",code)(name=>load(resolve(dirname(path),name)),mod,mod.exports);
 return mod.exports;
}
const {buildCottonOrderPreview}=load("lib/cotton-import/preview.ts");
const locations=[
 {id:"1",mcleod_code:"PICKTX",prev_code:"OLDTX",name:"Pickup TX",timezone:"America/Chicago",active:true},
 {id:"2",mcleod_code:"PICKGA",prev_code:null,name:"Pickup GA",timezone:"America/New_York",active:true}
];
const input={customerId:"BUNGOMNE",revenueCode:"MAIN",mark:"RR 803",baleCount:76,pickups:[{locationCode:"OLDTX",scheduledDate:"2026-11-02",scheduledTime:"08:30"},{locationCode:"PICKGA",scheduledDate:"2026-11-03",scheduledTime:"09:00"}]};
test("Bunge preview supports two pickups, legacy code, and destination",()=>{
 const p=buildCottonOrderPreview(input,locations);
 assert.equal(p.blnum,"RR 803 76 BALES");assert.equal(p.deliveryLocation,"SAVAGAG2");
 assert.deepEqual(p.pickupStops.map(s=>s.locationCode),["PICKTX","PICKGA"]);
 assert.equal(p.requiresScheduleReview,false);
});
test("missing times require review, never inferred",()=>{
 const p=buildCottonOrderPreview({...input,pickups:[{locationCode:"PICKTX",scheduledDate:"2026-11-02"}]},locations);
 assert.equal(p.requiresScheduleReview,true);assert.equal(p.pickupStops[0].scheduledTime,null);
});
test("invalid reference, date, count and unknown location block",()=>{
 for(const changes of [
  {baleCount:0},{mark:"BAD*MARK"},{customerId:"OTHER"},{pickups:[]},
  {pickups:[{locationCode:"UNKNOWN",scheduledDate:"2026-11-02"}]},
  {pickups:[{locationCode:"PICKTX",scheduledDate:"2026-02-30"}]}
 ]) assert.throws(()=>buildCottonOrderPreview({...input,...changes},locations));
});
