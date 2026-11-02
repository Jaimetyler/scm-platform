import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
const cache = new Map();
function load(file) {
 const path=resolve(file);
 if(cache.has(path)) return cache.get(path).exports;
 const mod={exports:{}}; cache.set(path,mod);
 const js=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function("require","module","exports",js)(name=>load(resolve(dirname(path),name)),mod,mod.exports);
 return mod.exports;
}
const {previewBungeDispatchOrders}=load("lib/cotton-import/bunge-review.ts");
const locations=[
 {id:"a",mcleod_code:"FUNSTGA",prev_code:null,name:"FUNSTON GIN CO",timezone:"America/New_York",active:true},
 {id:"b",mcleod_code:"BCTGIGA",prev_code:null,name:"BCT GIN COMPANY INC",timezone:"America/New_York",active:true}
];
const orders=[{mark:"D1085",salesOrder:"2511158",bales:90,pickups:[
 {row:6,mark:"D1085",salesOrder:"2511158",bales:30,warehouse:"FUNSTON GIN CO",rtl:"04/30/26"},
 {row:7,mark:"D1085",salesOrder:"2511158",bales:60,warehouse:"BCT GIN COMPANY INC",rtl:"04/30/26"}
]}];
test("Savannah Bunge dispatch resolves two pickup codes but requires schedule review",()=>{
 const result=previewBungeDispatchOrders(orders,"SAVANNAH",locations);
 assert.equal(result[0].status,"review_required");
 assert.equal(result[0].preview.blnum,"D1085 90 BALES");
 assert.deepEqual(result[0].preview.pickupStops.map(s=>s.locationCode),["FUNSTGA","BCTGIGA"]);
 assert.equal(result[0].preview.requiresScheduleReview,true);
});
test("unknown warehouse and Dallas destination fail closed",()=>{
 assert.equal(previewBungeDispatchOrders(orders,"DALLAS_2",locations)[0].status,"blocked");
 assert.match(previewBungeDispatchOrders(orders,"DALLAS_2",locations)[0].reason,/destination/);
 assert.equal(previewBungeDispatchOrders(orders,"SAVANNAH",[])[0].status,"blocked");
});
