import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const root = resolve(import.meta.dirname, "..");
const id = "11111111-1111-4111-8111-111111111111";
const hou = { id, email: "hou@example.test", user_id: id, role: "operator", terminal: "HOU", status: "active" };
const viewer = { ...hou, role: "viewer", terminal: null };
process.env.SCM_APP_URL = "https://scm.example.test";
function loadGuard(staff = hou, options = {}) {
  const writes = [];
  const db = { from(table) {
    const query = { select() { return this; }, eq() { return this; },
      insert(value) { writes.push({table,value}); return this; }, update() { return this; },
      async single() { return {data:{id},error:options.auditError}; },
      async maybeSingle() { return {data:options.missing ? null : {terminal: options.recordTerminal || "HOU"},error:options.dbError}; } };
    return query;
  } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = {exports:{}}; cache.set(file,mod.exports);
    const source = ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const localRequire = name => {
      if (name === "./session") return {
        staffDatabase:()=>db,
        requireSameOrigin:req=>{ if(req.headers.get("origin")!==process.env.SCM_APP_URL) throw new (load(resolve(root,"lib/auth/policy.ts")).AccessError)("Bad origin"); },
        staffSession:()=>({ identity:async()=>{
          if(options.unauthenticated) throw new (load(resolve(root,"lib/auth/policy.ts")).AccessError)("Sign in",401);
          return {staff,user:{id}};
        },finish:response=>response }),
      };
      if(name==="next/server") return {NextRequest,NextResponse};
      if(name.startsWith(".")) return load(resolve(dirname(file),name+".ts"));
      return require(name);
    };
    new Function("require","module","exports",source)(localRequire,mod,mod.exports);return mod.exports;
  }
  return { ...load(resolve(root,"lib/auth/guard.ts")), db, writes };
}
function req(path, method="GET", body, origin=true) {
  return new NextRequest(`https://scm.example.test${path}`,{method,headers:{...(origin?{origin:process.env.SCM_APP_URL}:{}),"content-type":"application/json"},
    ...(body===undefined ? {}:{body:JSON.stringify(body)})});
}
async function call(path, method, body, staff=hou, options={}) {
  const guard=loadGuard(staff,options); let ran=false;
  const route=guard.withStaffAccess(async request=>{ran=true;return NextResponse.json({ok:true,actor:guard.staffActor(request),url:request.url});});
  const response=await route(req(path,method,body,options.origin!==false));
  return {status:response.status,ran,guard,body:await response.json()};
}
test("Houston operator can create arrivals at both Houston sites",async()=>{
  for(const siteCode of ["5300","4331"]) {
    const result=await call("/api/warehouse/domestic-queue","POST",{terminal:"HOU",siteCode});
    assert.equal(result.status,200);assert.match(result.body.actor,/hou@example.test/);assert.equal(result.guard.writes.length,1);
  }
});
test("forged Houston body cannot authorize a Savannah row, inventory lot, container or booking",async()=>{
  for(const path of [`/api/inbound/checkin/rows/${id}`,`/api/warehouse/inventory/${id}`,"/api/warehouse/container-queue",
    "/api/warehouse/domestic-queue",`/api/warehouse/outbound/bookings/${id}/lines/${id}/rollover`]) {
    const result=await call(path,path.endsWith("rollover")?"POST":"PATCH",{id,terminal:"HOU"},hou,{recordTerminal:"SAV"});
    assert.equal(result.status,403,path);assert.equal(result.ran,false,path);
  }
});
test("moving a Houston row into Savannah is denied",async()=>{
  assert.equal((await call(`/api/inbound/checkin/rows/${id}`,"PATCH",{terminal:"SAV"})).status,403);
});
test("viewer can read/search both terminals but cannot operate, import, or manage invitations",async()=>{
  for(const terminal of ["HOU","SAV"]) assert.equal((await call(`/api/warehouse/domestic-queue?terminal=${terminal}`,"GET",undefined,viewer)).status,200);
  for(const path of ["/api/warehouse/domestic-queue","/api/warehouse/outbound/preview","/api/admin/users"])
    assert.equal((await call(path,"POST",{terminal:"HOU"},viewer)).status,403);
});
test("unknown, financial and QR settings APIs default to administrator-only",async()=>{
  for(const path of ["/api/warehouse/future-feature","/api/pnl/summary","/api/warehouse/gate-sites","/api/admin/users","/api/inbound/process-excel"])
    assert.equal((await call(path,"POST",{terminal:"HOU"})).status,403,path);
  assert.equal((await call("/api/warehouse/gate-sites","GET")).status,403);
});
test("inactive or missing staff, missing origin, and failed ownership lookups never reach handlers",async()=>{
  for(const status of ["pending","disabled"]) assert.equal((await call("/api/warehouse/inventory","GET",undefined,{...hou,status})).ran,false);
  assert.equal((await call("/api/warehouse/inventory","GET",undefined,hou,{unauthenticated:true})).status,401);
  for(const options of [{origin:false},{recordTerminal:"SAV"},{dbError:{message:"unavailable"}},{missing:true},{auditError:{message:"unavailable"}}])
    assert.equal((await call(`/api/inbound/checkin/rows/${id}`,"PATCH",{},hou,options)).ran,false);
});
test("cotton sync requires a saved row in the assigned terminal and live check-in source",async()=>{
  for(const body of [{row:{terminal:"HOU",source:"live_checkin"}},{checkinId:id,row:{terminal:"SAV",source:"live_checkin"}},
    {checkinId:id,row:{terminal:"HOU",source:"spreadsheet"}}]) assert.equal((await call("/api/inbound/sync","POST",body)).ran,false);
  assert.equal((await call("/api/inbound/sync","POST",{checkinId:id,row:{terminal:"HOU",source:"live_checkin"}})).status,200);
});
test("every internal API export is wrapped; only driver token and auth-session routes are public",()=>{
  function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(dir,entry.name)):[resolve(dir,entry.name)]);}
  for(const file of walk(resolve(root,"app/api")).filter(f=>f.endsWith("route.ts"))) {
    const portablePath = file.replaceAll(String.fromCharCode(92), "/");
    if(portablePath.includes("/api/gate/check-in/")||portablePath.endsWith("/api/auth/session/route.ts"))continue;
    const source=readFileSync(file,"utf8");
    assert.doesNotMatch(source,/export async function (GET|POST|PATCH|PUT|DELETE)/,file);
    const exports=[...source.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*([^;\n]+)/g)];
    assert.ok(exports.length,file);for(const match of exports)assert.ok(match[2].startsWith("withStaffAccess("),file);
  }
});

test("operator reads are restricted by query AND saved record ownership",async()=>{
  for(const path of ["/api/warehouse/inventory?terminal=SAV", `/api/warehouse/outbound/bookings/${id}/export?terminal=HOU`, `/api/warehouse/checkin-bol/${id}`, `/api/inbound/checkin/rows/${id}/dispatcher`]) {
    const result=await call(path,"GET",undefined,hou,{recordTerminal:"SAV"});
    assert.equal(result.status,403,path); assert.equal(result.ran,false,path);
  }
  for(const path of ["/api/warehouse/outbound/bookings","/api/warehouse/outbound/source-arrivals","/api/inbound/history?terminal=all"]) {
    const result=await call(path,"GET");
    assert.equal(result.status,200); assert.equal(new URL(result.body.url).searchParams.get("terminal"),"HOU");
  }
  const sav={...hou,terminal:"SAV"};
  assert.equal((await call("/api/warehouse/domestic-queue?terminal=HOU","GET",undefined,sav)).status,403);
});
