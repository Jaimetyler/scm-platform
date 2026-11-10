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

test("Moody #1 dispatch names resolve against the annotated active master record",()=>{
 const moody={id:"moody-1",mcleod_code:"MOODGAT1",prev_code:"858053",name:"Moody Compress #1 8-3pm out Van only",timezone:"America/Chicago",active:true};
 const other={id:"moody-3",mcleod_code:"MOODGAT4",prev_code:"858055",name:"Moody Compress #3",timezone:"America/Chicago",active:true};
 for(const warehouse of ["Moody Compress #1","Moody Compress #01","Moody Compress and Warehouse #1","  moody compress and warehouse #01  "]) {
  for(const usdaWarehouseCode of [null,"858053"]) {
   const dispatch=[{mark:"TEST1",salesOrder:"2609999",bales:90,pickups:[{row:1,mark:"TEST1",salesOrder:"2609999",bales:90,warehouse,rtl:"11/16/26",usdaWarehouseCode}]}];
   const result=previewBungeDispatchOrders(dispatch,"HOUSTON",[moody,other])[0];
   assert.equal(result.status,"review_required",result.reason);
   assert.equal(result.preview.pickupStops[0].locationCode,"MOODGAT1");
   const conflict=structuredClone(dispatch);conflict[0].pickups[0].usdaWarehouseCode="858055";
   assert.match(previewBungeDispatchOrders(conflict,"HOUSTON",[moody,other])[0].reason,/conflicts/);
   assert.match(previewBungeDispatchOrders(dispatch,"HOUSTON",[{...moody,active:false},other])[0].reason,/Inactive/);
  }
 }
});
test("unknown warehouse and Dallas destination fail closed",()=>{
 assert.equal(previewBungeDispatchOrders(orders,"DALLAS_2",locations)[0].status,"blocked");
 assert.match(previewBungeDispatchOrders(orders,"DALLAS_2",locations)[0].reason,/destination/);
 assert.equal(previewBungeDispatchOrders(orders,"SAVANNAH",[])[0].status,"blocked");
});

test("Houston Bunge orders route to Baytown without changing Savannah",()=>{
 const result=previewBungeDispatchOrders(orders,"HOUSTON",locations);
 assert.equal(result[0].status,"review_required");
 assert.equal(result[0].preview.deliveryLocation,"SUPPBAT1");
 assert.equal(result[0].preview.customerId,"BUNGOMNE");
 assert.equal(result[0].preview.revenueCode,"MAIN");
 assert.equal(previewBungeDispatchOrders(orders,"SAVANNAH",locations)[0].preview.deliveryLocation,"SAVAGAG2");
});

test("Houston dispatch USDA codes and actual Moody warehouse labels resolve together",()=>{
 const houstonLocations=[
  {id:"m3",mcleod_code:"MOODGAT4",prev_code:"858055",name:"Moody Compress #3",timezone:"America/Chicago",active:true},
  {id:"m4",mcleod_code:"MOODGAT3",prev_code:"858056",name:"Moody Compress #4",timezone:"America/Chicago",active:true}
 ];
 const dispatch=[{mark:"NX005",salesOrder:"2601771",bales:91,pickups:[
  {row:1,mark:"NX005",salesOrder:"2601771",bales:53,warehouse:"Moody Compress and Warehouse #03",rtl:"11/10/26",usdaWarehouseCode:"858055"},
  {row:2,mark:"NX005",salesOrder:"2601771",bales:38,warehouse:"Moody Compress and Warehouse #04",rtl:"11/10/26",usdaWarehouseCode:"858056"}
 ]}];
 const result=previewBungeDispatchOrders(dispatch,"HOUSTON",houstonLocations);
 assert.equal(result[0].status,"review_required");
 assert.deepEqual(result[0].preview.pickupStops.map(s=>s.locationCode),["MOODGAT4","MOODGAT3"]);
 assert.equal(result[0].preview.deliveryLocation,"SUPPBAT1");
 const conflict=structuredClone(dispatch);
 conflict[0].pickups[0].usdaWarehouseCode="858056";
 assert.equal(previewBungeDispatchOrders(conflict,"HOUSTON",houstonLocations)[0].status,"blocked");
});

