import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const mod = { exports: {} };
const source = readFileSync("lib/cotton-import/bunge-dispatch.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("module", "exports", js)(mod, mod.exports);
const { parseBungeDispatch } = mod.exports;
test("Bunge dispatch groups same SO and mark into two pickups", () => {
 const rows = [
  ["Destination:", "Supply Chain Management, LLC (SAV)"],
  ["Mark","SO"],
  ["D1085","2511158",null,null,30,null,null,null,null,"FUNSTON GIN CO",null,null,null,null,"04/30/26"],
  [null,null,null,null,null,null,null,null,null,"400 North McNaughton Blvd"],
  ["D1085","2511158",null,null,60,null,null,null,null,"BCT GIN COMPANY INC",null,null,null,null,"04/30/26"]
 ];
 const p = parseBungeDispatch(rows);
 assert.equal(p.orders.length,1);
 assert.equal(p.orders[0].bales,90);
 assert.deepEqual(p.orders[0].pickups.map(x=>x.warehouse),["FUNSTON GIN CO","BCT GIN COMPANY INC"]);
});
test("missing warehouse and third pickup are blocked",()=>{
 const rows=[["Destination:","Dallas #2"],["Mark","SO"],
 ["X","2523476",null,null,90,null,null,null,null,"GIN A",null,null,null,null,"07/24/26"],
 ["X","2523476",null,null,90,null,null,null,null,"GIN B",null,null,null,null,"07/24/26"],
 ["X","2523476",null,null,90,null,null,null,null,"GIN C",null,null,null,null,"07/24/26"]];
 const p=parseBungeDispatch(rows);
 assert.equal(p.orders.length,0);assert.equal(p.blocked.length,1);
});

test("Houston Underwood dispatch is routed to Houston for Baytown import",()=>{
 const rows=[["Destination:","Supply Chain Management LLC - 4331 Underwood Road, Pasadena TX"],["Mark","SO"],
 ["H123","2601771",null,null,40,null,null,null,null,"MOODY COMPRESS #03",null,null,null,null,"11/05/26"]];
 const p=parseBungeDispatch(rows);
 assert.equal(p.destinationKind,"HOUSTON");
 assert.equal(p.orders.length,1);
 assert.equal(p.orders[0].salesOrder,"2601771");
});
