import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const mod={exports:{}};
const code=ts.transpileModule(readFileSync("lib/ecotton/mail-intake.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
new Function("require","module","exports",code)(name=>require(name),mod,mod.exports);
const {prepareEmailIntake}=mod.exports;
const enc=new TextEncoder();
const report=(warehouse,kind)=>({
 filename:`${warehouse}-${kind}.csv`,
 bytes:enc.encode(`${warehouse==="843001"?"Supply Chain - Dallas 2 (843001)":"Supply Chain Management Dallas (875260)"},,,,\n${kind==="summary"?"Billing Summary":"Billing Report Detail to Export"},,,,\n`)
});
const base={providerMessageId:"abc",sender:"reports@example.com",receivedAt:"2026-11-02T12:00:00Z",attachments:[report("843001","summary"),report("843001","detail"),report("875260","summary"),report("875260","detail")]};
test("pairs both Dallas warehouses separately",()=>{
 const result=prepareEmailIntake(base,["reports@example.com"]);
 assert.deepEqual(result.pairs.map(x=>x.warehouse),["843001","875260"]);
 assert.equal(result.status,"awaiting_validation");
});
test("unknown sender and incomplete or duplicate report pairs are blocked",()=>{
 assert.throws(()=>prepareEmailIntake(base,["other@example.com"]),/Unapproved/);
 assert.throws(()=>prepareEmailIntake({...base,attachments:base.attachments.slice(0,1)},[base.sender]),/Incomplete/);
 assert.throws(()=>prepareEmailIntake({...base,attachments:[base.attachments[0],base.attachments[0]]},[base.sender]),/Duplicate/);
});
