import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { outsideCarrierOverrideEligible, canPrepareMcleodLookup, LEGACY_PREWRITE_CAP_ERROR } from "../lib/inbound/checkin/lookup-failure.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const id = "11111111-1111-4111-8111-111111111111";
const staffId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
function modules(overrides) {
  const cache = new Map();
  const load = path => {
    const full = resolve(root,path);
    if (cache.has(full)) return cache.get(full).exports;
    const module = {exports:{}}; cache.set(full,module);
    const source = ts.transpileModule(readFileSync(full,"utf8"), { fileName:full,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
    const local = name => {
      if (Object.hasOwn(overrides,name)) return overrides[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        const file = name.startsWith("@/") ? resolve(root,name.slice(2)) : resolve(dirname(full),name);
        return load(existsSync(file)?file:file+".ts");
      }
      return require(name);
    };
    new Function("require","module","exports","console",source)(local,module,module.exports,{log(){},warn(){}});
    return module.exports;
  };
  return load;
}
function baseRow(overrides={}) {
  return { id, terminal:"HOU",site_code:"5300",site_name:"Houston - 5300",sub_location:"MAIN",
    created_at:"2026-10-13T08:00:00Z",updated_at:"2026-10-13T08:00:00Z",checked_in_at:"2026-10-13T08:00:00Z",
    verified_at:"2026-10-13T10:00:00Z",received_date:"2026-10-13",checkin_source:"staff",
    driver_name:"Andy",trucking_company:"jordy transport",driver_phone:"555-0100",reference_number:"60136",
    movement_direction:"delivery",material_type:"cotton",yard_status:"working",draft_status:"checked_in",
    mark:"60136",shipper:"C1",bol_bc:88,bale_count:88,warehouse_location:"A",equipment_type:"V",verified:true,
    comment_1:"Original note",comment_2:"Original damage note",bol_photo_path:"private/photo.jpg",damage_photo_path:"private/damage.jpg",
    driver_latitude:29.75,matched_order_id:null,matched_stop_id:null,mcleod_lookup_has_known_match:false,
    ...overrides };
}
const order = () => ({ id:"ORDER1", status:"A",__statusDescr:"Available",revenue_code_id:"MAIN",commodity_id:"COTTON",
  customer_id:"C1",consignee_refno:"60136",blnum:"60136 88 BALES",pieces:88,
  movements:[{id:"MOVE1"}], stops:[{id:"PU1",stop_type:"PU",actual_arrival:"",actual_departure:""},
    {id:"SO1",stop_type:"SO",sched_arrive_early:"20261013080000-0500",actual_arrival:"",actual_departure:""}] });
async function scenario(options, run) {
  let row = baseRow(options.row);
  let serial=0, claims=0, searchCalls=0, externalWrites=0, rpcCalls=[], events=options.events ?? [];
  const savedFetch=globalThis.fetch;
  const keys=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","MCLEOD_BASE_URL","MCLEOD_AUTH_TOKEN","MCLEOD_SYNC_ENABLED"];
  const env=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test",MCLEOD_BASE_URL:"https://mcleod.test",MCLEOD_AUTH_TOKEN:"test",MCLEOD_SYNC_ENABLED:"true"});
  const staff={id:staffId,user_id:userId,role:"admin",status:"active",email:"staff@example.test",...options.staff};
  const save=value=>{
    row={...row,...value,updated_at:new Date(Date.parse("2026-10-13T10:00:00Z")+(++serial)*1000).toISOString()};
    if(row.matched_order_id||row.matched_stop_id)row.mcleod_lookup_has_known_match=true;
    if(["processed","outside_carrier"].includes(row.draft_status)&&row.mcleod_processing_phase==="complete")row.yard_status="completed";
    return {...row};
  };
  const db={from(table){
    if(table==="inbound_outside_carrier_events"){
      const filters=[];
      return {select(){return this;},eq(k,v){filters.push(event=>event[k]===v);return this;},
        async maybeSingle(){return options.auditReadError ? {error:options.auditReadError,status:options.auditStatus} : {data:events.find(event=>filters.every(fn=>fn(event))) ?? null};}};
    }
    assert.equal(table,"inbound_checkin_rows");let update,filters=[];
    const query={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,vs){filters.push(r=>vs.includes(r[k]));return this;},
      update(v){update=v;return this;},order(){return this;},gte(){return this;},limit(){return this;},
      async maybeSingle(){if(options.savedReadError)return{error:options.savedReadError,status:options.savedStatus};if(filters.some(fn=>!fn(row)))return{data:null};return{data:update?save(update):{...row}};},
      async single(){return this.maybeSingle();},then(resolve){return Promise.resolve({data:[{...row}]}).then(resolve);}};return query;},
    async rpc(name,args){rpcCalls.push({name,args});
      if(name==="complete_inbound_mcleod_already_done") {
        assert.equal(args.p_order_id,row.matched_order_id);
        assert.equal(args.p_stop_id,row.matched_stop_id);
        assert.equal(args.p_expected_updated_at,row.updated_at);
        assert.equal(row.mcleod_processing_phase,"lookup");
        assert.equal(args.p_staff_id,staff.id);
        return {data:[save({draft_status:"processed",yard_status:"completed",mcleod_processing_phase:"complete",processing_error:null})]};
      }
      if(name==="claim_inbound_checkin_row_v2"){
        if(row.draft_status!=="ready"||row.mcleod_processing_phase!=="lookup")return{data:[]};
        claims++;
        return{data:[save({draft_status:"processing",mcleod_lookup_attempt_id:crypto.randomUUID(),mcleod_processing_result_id:null,
          mcleod_lookup_status:"pending",mcleod_lookup_failure_code:null,mcleod_lookup_failed_at:null})]};
      }
      if(name==="retry_inbound_checkin_lookup"){
        if(row.updated_at!==args.p_expected_updated_at||row.draft_status!=="processing"||row.mcleod_processing_phase!=="lookup"||
            !["pending","searching","unresolved","conflict","error"].includes(row.mcleod_lookup_status))return{error:{code:"40001",message:"Not a read-only lookup"}};
        return{data:[save({mcleod_lookup_attempt_id:crypto.randomUUID(),mcleod_processing_result_id:null,mcleod_lookup_status:"pending"})]};
      }
      if(name==="complete_inbound_outside_carrier" || name==="complete_inbound_outside_carrier_auto"){
        if(name.endsWith("_auto")) { assert.equal(args.p_acknowledge_unresolved,undefined); args.p_reason="Automatic fallback during staff Finish cotton; verification unresolved; no McLeod update."; }
        if(options.manualError)return{error:options.manualError,status:options.manualStatus};
        const previous=events.find(event=>event.checkin_id===args.p_id);
        if(previous){
          if(previous.request_id===args.p_request_id && previous.lookup_attempt_id===args.p_lookup_attempt_id &&
            previous.actor_id===args.p_staff_id && previous.actor_user_id===args.p_user_id && previous.reason===args.p_reason &&
            row.outside_carrier_override_request_id===args.p_request_id && row.draft_status==="outside_carrier" && row.yard_status==="completed")return{data:[{...row}]};
          return{error:{code:"40001",message:"This arrival has already been completed; refresh the line"}};
        }
        if(args.p_expected_updated_at!==row.updated_at || args.p_lookup_attempt_id!==row.mcleod_lookup_attempt_id || !outsideCarrierOverrideEligible(row))
          return{error:{code:"40001",message:"This arrival changed or is not eligible"}};
        events.push({checkin_id:args.p_id,request_id:args.p_request_id,lookup_attempt_id:args.p_lookup_attempt_id,
          actor_id:args.p_staff_id,actor_user_id:args.p_user_id,reason:args.p_reason});
        assert.equal(args.p_expected_updated_at,row.updated_at);assert.equal(args.p_lookup_attempt_id,row.mcleod_lookup_attempt_id);
        assert.equal(args.p_staff_id,staff.id);assert.equal(args.p_user_id,staff.user_id);
        return{data:[save({draft_status:"outside_carrier",yard_status:"completed",outside_carrier_override_at:"2026-10-13T12:00:00Z",
          outside_carrier_override_request_id:args.p_request_id,outside_carrier_override_by:staff.email,outside_carrier_override_reason:args.p_reason,processing_error:null})]};
      }
      throw new Error(`Unexpected RPC ${name}`);
    }};
  const overrides={"next/server":{NextResponse:Response},"@supabase/supabase-js":{createClient:()=>db},
    "@/lib/auth/guard":{withStaffAccess:h=>h,staffActor:()=>`${staff.email} [${staff.user_id}]`,staffProfile:()=>staff}};
  const load=modules(overrides);
  const sync=load("app/api/inbound/sync/route.ts");
  const queue=load("app/api/warehouse/domestic-queue/route.ts");
  const request=body=>({url:"https://scm.test/api/warehouse/domestic-queue",headers:new Headers(),json:async()=>body});
  let loseSyncResponse=options.loseSyncResponse;
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url);
    if(parsed.host==="scm.test"){
      const result=await sync.POST(request(JSON.parse(init.body)));
      if(loseSyncResponse){loseSyncResponse=false;throw new TypeError("Lost internal response");}
      return result;
    }
    if(parsed.pathname.endsWith("/orders/search")){
      searchCalls++;assert.ok(init.signal,"Read stage has a finite abort deadline");
      if(options.searchError)throw new DOMException("Timed out","TimeoutError");
      if(options.bodyError)return{ok:true,status:200,text:async()=>{throw new TypeError("Lost read body");}};
      return Response.json(options.search ? options.search(parsed) : null);
    }
    if(parsed.pathname==="/orders/ORDER1")return Response.json(options.detail ?? order());
    if(parsed.pathname.startsWith("/carrierDispatch/clearStop/")){
      externalWrites++;assert.equal(row.mcleod_processing_phase,"write_pending");
      if(options.writeError)throw new DOMException("Write timeout","TimeoutError");
      return new Response("OK");
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const checkout=(extra={})=>queue.PATCH(request({action:"checkout",id,terminal:"HOU",siteCode:"5300",expectedUpdatedAt:row.updated_at,
    cotton:{mark:row.mark,customer:row.shipper,bolBC:row.bol_bc,baleCount:row.bale_count,warehouseLocation:row.warehouse_location,equipmentType:row.equipment_type},...extra}));
  const manual=(extra={})=>queue.PATCH(request({action:"process_outside_carrier",id,terminal:"HOU",siteCode:"5300",
    expectedUpdatedAt:row.updated_at,lookupAttemptId:row.mcleod_lookup_attempt_id,requestId:crypto.randomUUID(),
    acknowledgeUnresolved:true,...extra}));
  try{await run({checkout,manual,queue,sync,request,row:()=>row,save,stats:()=>({claims,searchCalls,externalWrites,rpcCalls,events})});}
  finally{globalThis.fetch=savedFetch;for(const key of keys)if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
}
const cap=()=>Array.from({length:200},(_,i)=>({id:`OTHER${i}`,revenue_code_id:"MAIN",customer_id:"C1",consignee_refno:"OTHER",blnum:"OTHER 88 BALES"}));

test("actual 60136 legacy cap requires fresh lookup, then audited staff completion without McLeod writes",async()=>{
  await scenario({row:{draft_status:"failed",processing_error:LEGACY_PREWRITE_CAP_ERROR},search:cap},async s=>{
    assert.equal(outsideCarrierOverrideEligible(s.row()),false);
    const response=await s.checkout(),body=await response.json();
    assert.equal(response.status,409);assert.equal(body.code,"MCLEOD_LOOKUP_UNRESOLVED");
    assert.equal(body.outsideCarrierEligible,true);assert.equal(body.row.outside_carrier_override_eligible,true);
    assert.equal(body.row.mcleod_lookup_failure_code,"SEARCH_LIMIT_REACHED");
    assert.equal(body.row.driver_latitude,undefined);assert.equal(body.row.bol_photo_path,undefined);
    assert.equal(s.stats().claims,1);assert.ok(s.stats().searchCalls>0);assert.equal(s.stats().externalWrites,0);
    const before={...s.row()},calls=s.stats().searchCalls;
    const manual=await s.manual(),result=await manual.json();
    assert.equal(manual.status,200);assert.equal(result.row.draft_status,"outside_carrier");assert.equal(result.row.yard_status,"completed");
    assert.equal(result.row.processing_error,null);assert.equal(result.row.mcleod_lookup_status,"unresolved");
    assert.equal(result.row.outside_carrier_override_eligible,false);assert.equal(s.stats().externalWrites,0);assert.equal(s.stats().searchCalls,calls);
    for(const field of ["checked_in_at","driver_name","trucking_company","reference_number","terminal","site_code","bol_photo_path","damage_photo_path","comment_1","comment_2"])
      assert.equal(s.row()[field],before[field],field);
  });
});
test("legacy generic and near-miss errors cannot obtain fresh v2 provenance",async()=>{
  for(const error of ["Fetch failed",LEGACY_PREWRITE_CAP_ERROR+" ",LEGACY_PREWRITE_CAP_ERROR.toLowerCase(),"McLeod search incomplete (result limit reached)"]){
    await scenario({row:{draft_status:"failed",processing_error:error}},async s=>{
      const response=await s.checkout();assert.equal(response.status,409);assert.equal((await response.json()).code,"MCLEOD_LEGACY_REVIEW_REQUIRED");
      assert.equal(s.stats().claims,0);assert.equal(s.stats().externalWrites,0);
    });
  }
});
test("pre-write network and response-body failures become typed unresolved, never automatic outside",async()=>{
  for(const option of [{searchError:true},{bodyError:true}])await scenario(option,async s=>{
    const body=await(await s.checkout()).json();assert.equal(body.code,"MCLEOD_LOOKUP_UNRESOLVED");
    assert.equal(body.row.mcleod_lookup_failure_code,"LOOKUP_UNAVAILABLE");assert.equal(s.row().draft_status,"failed");
    assert.equal(s.stats().externalWrites,0);
  });
});
test("complete no-match remains automatic outside-carrier receiving",async()=>{
  await scenario({},async s=>{
    const response=await s.checkout();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    assert.equal(s.row().draft_status,"outside_carrier");assert.equal(s.row().mcleod_lookup_status,"no_match");
    assert.equal(s.stats().rpcCalls.some(call=>call.name==="complete_inbound_outside_carrier"),false);assert.equal(s.stats().externalWrites,0);
  });
});

test("configured King Ranch receiving finishes locally without any McLeod lookup",async()=>{
  await scenario({row:{shipper:"KING RANCH"}},async s=>{
    const response=await s.checkout();const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(s.row().yard_status,"completed");assert.equal(s.row().local_receiving_only,true);
    assert.ok(s.row().physical_departed_at);
    assert.equal(s.stats().searchCalls,0);assert.equal(s.stats().externalWrites,0);
    assert.equal(s.stats().claims,0);
  });
});

test("unlinked known candidate already delivered is reconciled once without McLeod writes",async()=>{
  const closed=order();closed.status="D";closed.__statusDescr="Delivered";
  Object.assign(closed.stops[1],{location:{name:"SCM Houston 5300"},actual_arrival:"20261013070000-0500",actual_departure:"20261013080000-0500"});
  await scenario({row:{mcleod_lookup_has_known_match:true},search:()=>[closed],detail:closed},async s=>{
    const response=await s.checkout();const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.match(body.mcleod,/reconciled without McLeod write/);
    assert.equal(s.row().matched_order_id,"ORDER1");assert.equal(s.row().matched_stop_id,"SO1");
    assert.equal(s.row().mcleod_lookup_has_known_match,true);
    assert.equal(s.row().yard_status,"completed");assert.equal(s.stats().externalWrites,0);
    const calls=s.stats().rpcCalls.filter(c=>c.name==="complete_inbound_mcleod_already_done");
    assert.equal(calls.length,1);
    assert.equal(calls[0].args.p_mcleod_arrival,"20261013070000-0500");
    assert.equal(calls[0].args.p_mcleod_departure,"20261013080000-0500");
    assert.equal((await s.checkout()).status,200);
    assert.equal(s.stats().rpcCalls.filter(c=>c.name==="complete_inbound_mcleod_already_done").length,1);
  });
});

test("completed candidate with conflicting receiving or yard stays blocked without binding or writes",async()=>{
  for(const change of [o=>{o.customer_id="OTHER";},o=>{o.blnum="60136 90 BALES";},
    o=>{o.stops[1].location={name:"SCM Savannah 175"};},o=>{o.stops[1].actual_departure="";}]) {
    const closed=order();closed.status="D";closed.__statusDescr="Delivered";
    Object.assign(closed.stops[1],{location:{name:"SCM Houston 5300"},actual_arrival:"20261013070000-0500",actual_departure:"20261013080000-0500"});
    change(closed);
    await scenario({row:{mcleod_lookup_has_known_match:true},search:()=>[closed],detail:closed},async s=>{
      assert.equal((await s.checkout()).status,409);
      assert.equal(s.row().matched_order_id,null);assert.equal(s.row().mcleod_lookup_has_known_match,true);
      assert.equal(s.stats().externalWrites,0);
      assert.equal(s.stats().rpcCalls.some(c=>c.name==="complete_inbound_mcleod_already_done"),false);
    });
  }
});
test("known eligible SCM match processes normally; post-write timeout stays blocked",async()=>{
  for(const writeError of [false,true])await scenario({search:()=>[order()],writeError},async s=>{
    const response=await s.checkout();
    assert.equal(s.row().matched_order_id,"ORDER1");assert.equal(s.row().mcleod_lookup_has_known_match,true);
    if(writeError){assert.equal(response.status,409);assert.equal(s.row().mcleod_processing_phase,"write_pending");
      assert.equal(outsideCarrierOverrideEligible(s.row()),false);
      const calls=s.stats().externalWrites;assert.equal((await s.checkout()).status,409);assert.equal(s.stats().externalWrites,calls);
    }else{assert.equal(response.status,200);assert.equal(s.row().draft_status,"processed");assert.equal(s.stats().externalWrites,2);}
  });
});
test("known exact candidate survives a lost internal error response and blocks later outside fallback",async()=>{
  let first=true;
  await scenario({loseSyncResponse:true,search:()=>first?[order(),...cap().slice(1)]:null},async s=>{
    assert.equal((await s.checkout()).status,409);assert.equal(s.row().mcleod_lookup_has_known_match,true);
    first=false;
    const response=await s.checkout();assert.equal(response.status,409);
    assert.equal(outsideCarrierOverrideEligible(s.row()),false);assert.equal(s.row().draft_status,"failed");assert.equal(s.stats().externalWrites,0);
  });
});
test("saved order and stop are retained after incomplete lookup",async()=>{
  await scenario({row:{matched_order_id:"SAVED",matched_stop_id:"STOP"},search:cap},async s=>{
    const result=await(await s.checkout()).json();assert.equal(result.outsideCarrierEligible,undefined);
    assert.equal(s.row().matched_order_id,"SAVED");assert.equal(s.row().matched_stop_id,"STOP");assert.equal(s.stats().externalWrites,0);
  });
});
test("manual API rejects viewers, wrong yard operators and missing acknowledgements before RPC",async()=>{
  for(const staff of [{role:"viewer"},{role:"operator",terminal:"SAV"}])await scenario({staff},async s=>{
    const response=await s.manual({lookupAttemptId:crypto.randomUUID()});assert.equal(response.status,403);assert.equal(s.stats().rpcCalls.length,0);
  });
  await scenario({},async s=>{for(const body of [{acknowledgeUnresolved:false},{expectedUpdatedAt:"bad"},{requestId:"bad"},{lookupAttemptId:"bad"}]){
    assert.equal((await s.manual({lookupAttemptId:crypto.randomUUID(),...body})).status,400);assert.equal(s.stats().rpcCalls.length,0);
  }});
});
test("read-only interrupted lookup can be fenced and retried; matched/write-pending cannot",async()=>{
  for(const phase of ["lookup","matched","write_pending"])await scenario({row:{draft_status:"processing",mcleod_processing_phase:phase,
    mcleod_lookup_status:"searching",mcleod_lookup_attempt_id:crypto.randomUUID()},search:cap},async s=>{
    const old=s.row().mcleod_lookup_attempt_id;
    const response=await s.queue.PATCH(s.request({action:"retry_lookup",id,terminal:"HOU",siteCode:"5300",expectedUpdatedAt:s.row().updated_at}));
    if(phase==="lookup"){assert.equal((await response.json()).outsideCarrierEligible,true);assert.notEqual(s.row().mcleod_lookup_attempt_id,old);}
    else{assert.equal(response.status,409);assert.equal(s.row().mcleod_lookup_attempt_id,old);assert.equal(s.stats().searchCalls,0);}
    assert.equal(s.stats().externalWrites,0);
  });
});
test("lookup failure persisted before interrupted response remains explicitly retryable",async()=>{
  for(const status of ["pending","unresolved","conflict","error"])await scenario({row:{draft_status:"processing",mcleod_processing_phase:"lookup",
    mcleod_lookup_status:status,mcleod_lookup_attempt_id:crypto.randomUUID(),mcleod_lookup_has_known_match:status==="conflict"},search:cap},async s=>{
    const old=s.row().mcleod_lookup_attempt_id;
    const response=await s.queue.PATCH(s.request({action:"retry_lookup",id,terminal:"HOU",siteCode:"5300",expectedUpdatedAt:s.row().updated_at}));
    const body=await response.json();assert.equal(response.status,409);assert.notEqual(s.row().mcleod_lookup_attempt_id,old);
    assert.equal(Boolean(body.outsideCarrierEligible),status!=="conflict");assert.equal(s.stats().externalWrites,0);
  });
});
test("sync ignores forged row data and consumes a processing attempt only once",async()=>{
  await scenario({row:{draft_status:"processing",mcleod_processing_phase:"lookup",mcleod_lookup_status:"pending",mcleod_lookup_attempt_id:crypto.randomUUID()}},async s=>{
    const body={checkinId:id,lookupAttemptId:s.row().mcleod_lookup_attempt_id,row:{source:"live_checkin",mark:"FORGED",terminal:"SAV",balesUnloaded:1}};
    const first=await s.sync.POST(s.request(body));assert.equal(first.status,200);assert.equal((await first.json()).outsideCarrier,true);
    const calls=s.stats().searchCalls;
    const replay=await s.sync.POST(s.request(body));assert.equal(replay.status,409);assert.equal(s.stats().searchCalls,calls);assert.equal(s.stats().externalWrites,0);
  });
});
test("manual eligibility requires typed persisted evidence, never processing_error text",()=>{
  const row=baseRow({draft_status:"failed",mcleod_processing_phase:"lookup",mcleod_lookup_status:"unresolved",
    mcleod_lookup_attempt_id:crypto.randomUUID(),mcleod_lookup_failed_at:new Date().toISOString(),mcleod_lookup_failure_code:"SEARCH_LIMIT_REACHED"});
  assert.equal(outsideCarrierOverrideEligible(row),true);
  for(const changed of [{matched_order_id:"KNOWN"},{matched_stop_id:"STOP"},{mcleod_lookup_has_known_match:true},{mcleod_processing_phase:"write_pending"},
    {mcleod_lookup_attempt_id:null},{mcleod_lookup_status:"error"},{yard_status:"cancelled"},{draft_status:"processing"},{material_type:"lumber"}])
    assert.equal(outsideCarrierOverrideEligible({...row,...changed}),false);
  assert.equal(canPrepareMcleodLookup({...baseRow(),draft_status:"failed",processing_error:LEGACY_PREWRITE_CAP_ERROR}),true);
  assert.equal(canPrepareMcleodLookup({...baseRow(),draft_status:"checked_in",mcleod_processing_phase:"legacy_review"}),false);
});

const manualFailure = () => ({draft_status:"failed",mcleod_processing_phase:"lookup",mcleod_lookup_status:"unresolved",
  mcleod_lookup_attempt_id:crypto.randomUUID(),mcleod_lookup_failed_at:"2026-10-13T09:00:00Z",mcleod_lookup_failure_code:"LOOKUP_UNAVAILABLE"});
test("manual confirmation generates audit reason on server and replays without creating another audit",async()=>{
  for(const staff of [{role:"admin"},{role:"operator",terminal:"HOU"}])await scenario({staff,row:manualFailure()},async s=>{
    const requestId=crypto.randomUUID(),before={...s.row()};
    const extra={requestId,expectedUpdatedAt:before.updated_at,reason:"Client claims a verified McLeod no-match"};
    assert.equal((await s.manual(extra)).status,200);
    const completed={...s.row()},reason=completed.outside_carrier_override_reason;
    assert.equal(reason,"Staff confirmed physical movement completed as outside carrier; McLeod verification remains unresolved; no McLeod update.");
    assert.equal(completed.mcleod_lookup_failure_code,before.mcleod_lookup_failure_code);
    assert.equal(completed.mcleod_lookup_failed_at,before.mcleod_lookup_failed_at);
    assert.equal((await s.manual({...extra,reason:"Different client prose"})).status,200);
    assert.deepEqual(s.row(),completed);assert.equal(s.stats().events.length,1);assert.equal(s.stats().externalWrites,0);
    assert.equal((await s.manual()).status,409);assert.equal(s.stats().events.length,1);
  });
});
test("legacy same-request replay preserves the original reason and audit without accepting client provenance",async()=>{
  const attempt=crypto.randomUUID(),requestId=crypto.randomUUID(),reason="Original staff-entered reason";
  const event={checkin_id:id,request_id:requestId,lookup_attempt_id:attempt,actor_id:staffId,actor_user_id:userId,reason};
  await scenario({events:[event],row:{...manualFailure(),mcleod_lookup_attempt_id:attempt,draft_status:"outside_carrier",yard_status:"completed",
    outside_carrier_override_request_id:requestId,outside_carrier_override_at:"2026-10-13T10:00:00Z",outside_carrier_override_reason:reason}},async s=>{
    const before={...s.row()};
    assert.equal((await s.manual({requestId,expectedUpdatedAt:"2026-10-13T07:00:00Z",reason:"Forged replacement"})).status,200);
    assert.deepEqual(s.row(),before);assert.deepEqual(s.stats().events,[event]);
    assert.equal(s.stats().rpcCalls[0].args.p_reason,reason);
  });
});
test("manual stale revision, stale attempt, and lookup audit read failures cannot complete the movement",async()=>{
  await scenario({row:manualFailure()},async s=>{
    for(const extra of [{expectedUpdatedAt:"2026-10-13T07:00:00Z"},{lookupAttemptId:crypto.randomUUID()}])
      assert.equal((await s.manual(extra)).status,409);
    assert.equal(s.row().draft_status,"failed");assert.equal(s.stats().events.length,0);
  });
  await scenario({row:manualFailure(),auditReadError:{message:"Audit read unavailable"}},async s=>{
    assert.equal((await s.manual()).status,500);assert.equal(s.stats().rpcCalls.length,0);assert.equal(s.row().draft_status,"failed");
  });
});

test("legacy replay cannot borrow another actor, request, or lookup attempt audit reason",async()=>{
  for(const mismatch of ["actor","user","request","attempt"]){
    const attempt=crypto.randomUUID(),requestId=crypto.randomUUID(),reason="Legacy saved reason";
    const event={checkin_id:id,request_id:requestId,lookup_attempt_id:attempt,actor_id:staffId,actor_user_id:userId,reason};
    if(mismatch==="actor")event.actor_id=crypto.randomUUID();
    if(mismatch==="user")event.actor_user_id=crypto.randomUUID();
    await scenario({events:[event],row:{...manualFailure(),mcleod_lookup_attempt_id:attempt,draft_status:"outside_carrier",yard_status:"completed",
      outside_carrier_override_request_id:requestId,outside_carrier_override_at:"2026-10-13T10:00:00Z",outside_carrier_override_reason:reason}},async s=>{
      const before={...s.row()};
      assert.equal((await s.manual({requestId:mismatch==="request"?crypto.randomUUID():requestId,
        lookupAttemptId:mismatch==="attempt"?crypto.randomUUID():attempt,reason})).status,409);
      assert.deepEqual(s.row(),before);assert.deepEqual(s.stats().events,[event]);
      assert.notEqual(s.stats().rpcCalls[0].args.p_reason,reason);
    });
  }
});


test("outside RPC transport/status-zero/timeouts are 503, never business conflicts",async()=>{
  for(const [status,error] of [[0,{code:'',message:'DependencyError: The upstream service did not respond.'}],
    [503,{code:'',message:'Unavailable'}],[408,{code:'',message:'Timeout'}],[400,{code:'57014',message:'cancelled'}]]){
    await scenario({row:manualFailure(),manualError:error,manualStatus:status},async s=>{
      const response=await s.manual();assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'10');
      const body=await response.json();assert.equal(body.code,'DEPENDENCY_UNAVAILABLE');assert.match(body.error,/may already have completed/);
      assert.equal(s.stats().events.length,0);assert.equal(s.stats().externalWrites,0);
    });
  }
  await scenario({row:manualFailure(),manualError:{code:'40001',message:'stale'},manualStatus:409},async s=>{
    const response=await s.manual();assert.equal(response.status,409);assert.equal((await response.json()).code,'CHECKOUT_CONFLICT');
  });
});

test("audit transport failure is 503 before RPC and scoped saved reads use no McLeod",async()=>{
  await scenario({row:manualFailure(),auditReadError:{code:'',message:'DependencyError: timeout'},auditStatus:0},async s=>{
    assert.equal((await s.manual()).status,503);assert.equal(s.stats().rpcCalls.length,0);
  });
  await scenario({row:{...manualFailure(),checked_in_at:'2020-01-01T00:00:00Z'}},async s=>{
    const get=(siteCode='5300',value=id)=>s.queue.GET(new Request(`https://scm.test/api/warehouse/domestic-queue?terminal=HOU&siteCode=${siteCode}&id=${value}`));
    const response=await get();assert.equal(response.status,200);assert.equal((await response.json()).row.id,id);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await get('4331')).status,404);
    assert.equal((await get('5300','bad')).status,400);assert.equal(s.stats().searchCalls,0);assert.equal(s.stats().externalWrites,0);assert.equal(s.stats().rpcCalls.length,0);
  });
  await scenario({row:manualFailure(),savedReadError:{code:'',message:'Unavailable'},savedStatus:0},async s=>{
    assert.equal((await s.queue.GET(new Request(`https://scm.test/api/warehouse/domestic-queue?terminal=HOU&siteCode=5300&id=${id}`))).status,503);
  });
});


test("actual Supabase SDK transport wrapping retains status-zero evidence for the route classifier",async()=>{
  const {createClient}=require('@supabase/supabase-js');
  const client=createClient('https://fixture.invalid','synthetic',{global:{fetch:async()=>{
    const error=new Error('The upstream service did not respond. Please try again.');error.name='DependencyError';throw error;
  }}});
  const result=await client.rpc('complete_inbound_outside_carrier',{});
  assert.equal(result.status,0);assert.equal(result.error.code,'');
  await scenario({row:manualFailure(),manualError:result.error,manualStatus:result.status},async s=>{
    const response=await s.manual();assert.equal(response.status,503);assert.equal((await response.json()).code,'DEPENDENCY_UNAVAILABLE');
  });
});


test("Finish cotton automatically completes a fresh eligible lookup failure with one honest audit",async()=>{
  await scenario({searchError:true},async s=>{
    const finishCottonRequestId=crypto.randomUUID();
    const first=await s.checkout({finishCottonRequestId}); assert.equal(first.status,200);
    assert.equal(s.row().yard_status,"completed"); assert.equal(s.row().mcleod_lookup_status,"unresolved");
    assert.equal(s.stats().events.length,1);assert.equal(s.stats().externalWrites,0);
    assert.equal(s.stats().rpcCalls.at(-1).name,"complete_inbound_outside_carrier_auto");
    assert.match(s.stats().events[0].reason,/Automatic fallback/);
    const calls=s.stats().searchCalls;
    assert.equal((await s.checkout({finishCottonRequestId})).status,200);
    assert.equal(s.stats().events.length,1);assert.equal(s.stats().searchCalls,calls);
    assert.equal((await s.checkout({finishCottonRequestId:crypto.randomUUID()})).status,200);
    assert.equal(s.stats().events.length,1);
  });
});
test("automatic fallback never consumes unversioned legacy errors, known matches, or uncertain writes",async()=>{
  for(const row of [
    {draft_status:"failed",processing_error:"HTTP500",mcleod_processing_phase:"legacy_review"},
    {...manualFailure(),matched_order_id:"ORDER1",mcleod_lookup_has_known_match:true,mcleod_processing_phase:"write_pending"},
    {...manualFailure(),mcleod_lookup_has_known_match:true},
  ]) await scenario({row,searchError:true},async s=>{
    const result=await s.checkout({finishCottonRequestId:crypto.randomUUID()});assert.notEqual(result.status,200);
    assert.equal(s.stats().events.length,0);assert.equal(s.stats().externalWrites,0);
  });
});
test("automatic fallback timeout exposes uncertain recovery without reprocessing",async()=>{
  await scenario({searchError:true,manualError:{code:"57014",message:"timeout"}},async s=>{
    const result=await s.checkout({finishCottonRequestId:crypto.randomUUID()}); assert.equal(result.status,503);
    assert.match((await result.json()).error,/may already have completed/);assert.equal(s.stats().externalWrites,0);
    const before=s.stats().searchCalls;
    const saved=await s.queue.GET(new Request(`https://scm.test/api/warehouse/domestic-queue?terminal=HOU&siteCode=5300&id=${id}`));
    assert.equal(saved.status,200);assert.equal(s.stats().searchCalls,before);
  });
});

test("Finish cotton no-match stays confirmed no-match and does not create fallback audit",async()=>{
  await scenario({},async s=>{
    assert.equal((await s.checkout({finishCottonRequestId:crypto.randomUUID()})).status,200);
    assert.equal(s.row().mcleod_lookup_status,"no_match");assert.equal(s.row().yard_status,"completed");
    assert.equal(s.stats().events.length,0);assert.equal(s.stats().externalWrites,0);
  });
});
test("Finish cotton validates inputs and staff before searching or falling back",async()=>{
  for(const options of [{staff:{role:"viewer"}},{staff:{role:"operator",terminal:"SAV"}}])
    await scenario(options,async s=>{
      assert.equal((await s.checkout({finishCottonRequestId:crypto.randomUUID()})).status,403);
      assert.equal(s.stats().searchCalls,0);assert.equal(s.stats().events.length,0);
    });
  await scenario({},async s=>{
    assert.equal((await s.checkout({finishCottonRequestId:"invalid"})).status,400);
    assert.equal((await s.checkout({finishCottonRequestId:crypto.randomUUID(),cotton:{}})).status,400);
    assert.equal(s.stats().searchCalls,0);assert.equal(s.stats().events.length,0);
  });
});
test("Finish cotton uses a fresh attempt instead of reusing old eligible unresolved evidence",async()=>{
  await scenario({row:manualFailure(),searchError:true},async s=>{
    const old=s.row().mcleod_lookup_attempt_id;
    assert.equal((await s.checkout({finishCottonRequestId:crypto.randomUUID()})).status,200);
    assert.notEqual(s.row().mcleod_lookup_attempt_id,old);assert.equal(s.stats().claims,1);
    assert.equal(s.stats().events[0].lookup_attempt_id,s.row().mcleod_lookup_attempt_id);
  });
});
