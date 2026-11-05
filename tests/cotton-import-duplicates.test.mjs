import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import ts from "typescript";
const cache=new Map();
function load(file){const path=resolve(file);if(cache.has(path))return cache.get(path).exports;
 const mod={exports:{}};cache.set(path,mod);
 const js=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function("require","module","exports",js)(name=>load(resolve(dirname(path),name)),mod,mod.exports);
 return mod.exports;
}
const {checkCottonDuplicates}=load("lib/cotton-import/duplicates.ts");
const key={customerId:"BUNGOMNE",revenueCode:"MAIN",blnum:"EH020 90 BALES",salesOrder:"2601968"};
test("no-match McLeod null response is a complete empty duplicate lookup",async()=>{
 assert.deepEqual(await checkCottonDuplicates(async()=>null,key),[]);
});
test("matching McLeod order blocks duplicate creation",async()=>{
 const read=async path=>path.startsWith("/orders/search")?[{id:"0829999"}]:{id:"0829999",blnum:key.blnum,customer_id:"BUNGOMNE",revenue_code_id:"MAIN"};
 assert.equal((await checkCottonDuplicates(read,key)).length,1);
});
test("unknown search response fails closed",async()=>{
 await assert.rejects(checkCottonDuplicates(async()=>({error:"truncated",rows:[]}),key),/invalid page/);
});
