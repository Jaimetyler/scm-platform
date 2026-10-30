import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require=createRequire(import.meta.url), root=resolve(import.meta.dirname,"..");
const {NextRequest,NextResponse}=require("next/server");
process.env.SUPABASE_URL="https://supabase.example.test";
process.env.SUPABASE_ANON_KEY="test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-service";
process.env.SCM_APP_URL="https://scm.example.test";
function scenario(options={}) {
  const calls=[];
  const user={id:"user-1",email:"person@example.test",email_confirmed_at:"2026-01-01",...options.user};
  const profile={id:"staff-1",email:user.email,user_id:user.id,status:"active",role:"operator",terminal:"HOU",...options.profile};
  const auth={getUser:async()=>({data:{user},error:options.authError}),
    verifyOtp:async args=>{calls.push(["otp",args]);return {error:options.otpError};},
    signInWithPassword:async()=>({error:options.loginError}),signOut:async()=>({error:options.logoutError}),
    updateUser:async()=>{calls.push(["password"]);return {error:null};},
    resetPasswordForEmail:async()=>{calls.push(["recovery"]);return {error:options.recoveryError ?? null};},
    admin:{inviteUserByEmail:async()=>({error:options.inviteError})}};
  const db={auth,from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:options.missing?null:profile,error:options.dbError})}),
    rpc:async(name,args)=>{calls.push([name,args]);return {data:profile,error:options.activateError};}};
  const cache=new Map();
  function load(file) {
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};cache.set(file,module.exports);
    const source=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const localRequire=name=>{
      if(name==="next/server")return {NextRequest,NextResponse};
      if(name==="@supabase/ssr")return {createServerClient:()=>({auth})};
      if(name==="@supabase/supabase-js")return {createClient:()=>db};
      if(name.startsWith(".")||name.startsWith("@/"))return load(resolve(name.startsWith("@/")?root:dirname(file),(name.startsWith("@/")?name.slice(2):name)+".ts"));
      return require(name);
    };
    new Function("require","module","exports",source)(localRequire,module,module.exports);return module.exports;
  }
  const request=body=>new NextRequest("https://scm.example.test/api/auth/session",{method:"POST",headers:{origin:process.env.SCM_APP_URL,"content-type":"application/json"},body:JSON.stringify(body)});
  return {load:file=>load(resolve(root,file)),calls,request};
}
test("identity comes from verified Auth user and server profile, never cookie claims or metadata",async()=>{
  for(const options of [{authError:{message:"forged token"}},{user:{email_confirmed_at:null}},{missing:true},
    {profile:{status:"disabled"}},{profile:{user_id:"another-user"}},{profile:{status:"pending",invite_expires_at:"2001-01-01"}},{dbError:{message:"offline"}}]) {
    const s=scenario(options);await assert.rejects(s.load("lib/auth/session.ts").staffSession(s.request({})).identity());
  }
  const s=scenario({user:{user_metadata:{role:"admin"}}});
  assert.equal((await s.load("lib/auth/session.ts").staffSession(s.request({})).identity()).staff.role,"operator");
});
test("accept verifies a one-time token but does not activate before password setup",async()=>{
  const s=scenario({profile:{status:"pending",invite_expires_at:"2099-01-01"}});
  const route=s.load("app/api/auth/session/route.ts");
  const response=await route.POST(s.request({action:"accept",type:"invite",token_hash:"one-time-hash"}));
  assert.equal(response.status,200);assert.equal((await response.json()).next,"/auth/password");
  assert.deepEqual(s.calls.map(c=>c[0]),["otp"]);
  const saved=await route.POST(s.request({action:"password",password:"a long test password"}));
  assert.equal(saved.status,200);assert.deepEqual(s.calls.map(c=>c[0]),["otp","password","scm_accept_staff"]);
});
test("cancelled, expired, weak-password and consumed-token flows cannot activate accounts",async()=>{
  for(const [options,body] of [
    [{profile:{status:"disabled"}},{action:"password",password:"a long test password"}],
    [{profile:{status:"pending",invite_expires_at:"2001-01-01"}},{action:"password",password:"a long test password"}],
    [{},{action:"password",password:"short"}],
    [{otpError:{message:"expired"}},{action:"accept",type:"invite",token_hash:"used"}],
    [{},{action:"accept",type:"signup",token_hash:"other"}],
  ]) {
    const s=scenario(options);const response=await s.load("app/api/auth/session/route.ts").POST(s.request(body));
    assert.ok(response.status>=400);assert.equal(s.calls.some(c=>c[0]==="scm_accept_staff"),false);
  }
});
test("resending to an already verified email sends recovery without changing its access",async()=>{
  const s=scenario({inviteError:{code:"email_exists"}});
  assert.equal((await s.load("lib/auth/invitations.ts").sendStaffInvitation("person@example.test")).error,null);
  assert.deepEqual(s.calls.map(c=>c[0]),["recovery"]);
});

test("dependency outages return retryable 503, while invalid credentials remain 401", async () => {
  for (const loginError of [{status:500}, {status:504}, {name:"AuthRetryableFetchError"}, {message:"offline"}]) {
    const s=scenario({loginError});
    const response=await s.load("app/api/auth/session/route.ts").POST(s.request({action:"login"}));
    assert.equal(response.status,503); assert.equal(response.headers.get("Retry-After"),"10");
    assert.doesNotMatch((await response.json()).error,/password was not accepted/);
  }
  const s=scenario({loginError:{code:"invalid_credentials",status:400}});
  assert.equal((await s.load("app/api/auth/session/route.ts").POST(s.request({action:"login"}))).status,401);
});
test("auth/profile outages fail closed without mislabelling access and recovery email failures surface",async()=>{
  for(const options of [{authError:{status:503}},{dbError:{message:"offline"}}]) {
    const s=scenario(options);
    await assert.rejects(s.load("lib/auth/session.ts").staffSession(s.request({})).identity(),e=>e.status===503);
  }
  const s=scenario({recoveryError:{status:503}});
  assert.equal((await s.load("app/api/auth/session/route.ts").POST(s.request({action:"recover",email:"person@example.test"}))).status,503);
});
test("middleware distinguishes temporary outages from genuine access failures",async()=>{
  for(const [options,status,path] of [[{authError:{status:504}},503,null],[{dbError:{message:"offline"}},503,null],
    [{authError:{status:401,code:"bad_jwt"}},307,"/login"],[{profile:{status:"disabled"}},307,"/access-denied"]]) {
    const s=scenario(options); const response=await s.load("middleware.ts").middleware(new NextRequest("https://scm.example.test/warehouse"));
    assert.equal(response.status,status);
    if(path)assert.equal(new URL(response.headers.get("location")).pathname,path);
    else {assert.equal(response.headers.get("location"),null);assert.match(await response.text(),/temporarily unavailable/);}
  }
});

test("invitation activation outage is retryable while expired/cancelled rejection remains forbidden",async()=>{
  for(const [activateError,status] of [[{code:"08006",message:"connection lost"},503],[{code:"P0001",message:"Invitation expired or cancelled"},403]]) {
    const s=scenario({profile:{status:"pending",invite_expires_at:"2099-01-01"},activateError});
    const response=await s.load("app/api/auth/session/route.ts").POST(s.request({action:"password",password:"a long test password"}));
    assert.equal(response.status,status);
    assert.equal(response.headers.get("Retry-After"),status===503?"10":null);
  }
});
