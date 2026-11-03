import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";
import {PGlite} from "@electric-sql/pglite";
const require=createRequire(import.meta.url), cache=new Map();
function load(file) {
  const path=resolve(file); if(cache.has(path)) return cache.get(path).exports;
  const m={exports:{}};cache.set(path,m);
  const code=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function("require","module","exports",code)(name=>name.startsWith(".")?load(resolve(dirname(path),name)):require(name),m,m.exports);
  return m.exports;
}
const {parseDrays,containerKey,portLocation}=load("lib/dray/parse.ts");
const {PROFILE,SAVANNAH_RATES}=load("lib/dray/model.ts");
const {buildPayload,verifyRatedOrder,findDuplicates,expectedCharges,billingNormalizationPayload}=load("lib/dray/mcleod.ts");
const {processInvoice,reconcileInvoice,repairCreatedInvoice}=load("lib/dray/engine.ts");
const {buildDeliveryPlan,deliverInvoice,reconcileDelivery}=load("lib/dray/delivery.ts");
const columns=["Invoice Date","Shipper ID","Shipper","Shippers Order#","Marks","File Number","Pickup Point","SS LINE","Equipment Tracking","Shipping Order","Booking Number","CHASSIS","Seal Number"];
const source=(change={})=>({"Invoice Date":"10/26/2026","Shipper ID":"SYN","Shipper":"Louis Dreyfus Company Cotton","Shippers Order#":"SO-CUSTOMER-1","Marks":"MARK1","File Number":"FILE1","Pickup Point":"GPA","SS LINE":"MSC","Equipment Tracking":"ABCU1234567","Shipping Order":"SHIP1","Booking Number":"BOOK1",CHASSIS:"SCMI1","Seal Number":"SEAL1",...change});
function csv(rows=[source()], names=columns){return [names,...rows.map(r=>names.map(n=>r[n]??""))].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n")}
const first=(extra=[])=>[["Load Listing"],["Load#","Term","Container#","Bill Ref#","Total","Voided"],["FIRST1",700,"ABCU123456","FILE FILE1",200,""],...extra];
const invoice=()=>parseDrays(csv(),first()).invoices[0];
function order(i=invoice()) {
  const o={...buildPayload(i,PROFILE),otherCharges:expectedCharges(i,PROFILE).map((c,n)=>({...c,id:"CHARGE"+n,order_id:"ORDER1"})),id:"ORDER1",curr_movement_id:"MOVE1",ready_to_bill:false};
  o.stops=o.stops.map((s,n)=>({...s,id:"STOP"+n,order_id:o.id,movement_id:"MOVE1"}));
  o.movements=o.movements.map(m=>({...m,id:"MOVE1",status:"A",origin_stop_id:"STOP0",dest_stop_id:"STOP1"}));
  return o;
}
function harness(i=invoice()) {
  let row={id:"ROW1",status:"ready",invoice:i,profile:PROFILE,order_id:null};
  let current=null;const writes=[];
  const store={claim:async(id,from,to,note)=>{if(row.status!==from)return null;row={...row,status:to,note};return {...row}},finish:async(r,state,id,note)=>{row={...r,status:state,order_id:id,note}}};
  const vendor={read:async path=>path.startsWith("/orders/search?")?[]:structuredClone(current),write:async(path,body)=>{
    writes.push({path,body});
    if(path==="/orders/create"){current=order(i);return{id:"ORDER1"}}
    if(path==="/orders/updateRow"){Object.assign(current,body);if(body.otherCharges)current.otherCharges=body.otherCharges.filter(c=>!c.__deleted).map((c,n)=>({...c,id:c.id||"ADDED"+n,order_id:current.id}));}
    if(path==="/stop/update") Object.assign(current.stops.find(s=>s.id===body.id),body);
    if(path==="/movement/update") Object.assign(current.movements[0],body);
    return {};
  }};
  return {get row(){return row}, get order(){return current},store,vendor,writes};
}
test("new report headers map semantically, with shifted/reordered columns",()=>{
  const i=parseDrays(csv([source()], [...columns].reverse()),first()).invoices[0];
  assert.equal(i.reference,"MARK1");assert.equal(i.mark,"ABCU1234567");assert.equal(i.cents,48500);assert.equal(i.carrierCents,20000);assert.equal(i.customerId,"ALLELOTN");assert.deepEqual(i.inputErrors,[]);
});
test("check digit normalization preserves first six serial digits; invalid short numbers are rejected",()=>{
  assert.equal(containerKey("ABCU1234567"),containerKey("abcu 123456"));assert.throws(()=>containerKey("080"));assert.equal(containerKey("ABCU0000010"),"ABCU000001");
});
test("skip NOBILL, missing port and missing steamship; unknown port requires review",()=>{
  const result=parseDrays(csv([source(),source({"SS LINE":"NOBILL"}),source({"Pickup Point":""}),source({"SS LINE":""}),source({"Pickup Point":"OTHER","Shipping Order":"SHIP2"})]),first());
  assert.equal(result.skipped.length,3);assert.equal(result.invoices.length,2);assert.match(result.invoices[1].inputErrors.join(),/Unknown port/);
  for(const v of ["OT","O T"," Ocean Terminal "])assert.equal(portLocation(v),"SAVOT");
});
test("all ten customers have warehouse-specific port rates and chassis; Olam retains zero line",()=>{
  assert.equal(SAVANNAH_RATES.length,10);
  for(const c of SAVANNAH_RATES){const i=parseDrays(csv([source({Shipper:c.aliases[0],"Pickup Point":"OT"})]),first()).invoices[0];assert.equal(i.baseCents,c.ocean);assert.equal(i.cents,c.ocean+c.chassis);assert.equal(i.customerId,c.code)}
  const o=parseDrays(csv([source({Shipper:"Olam Cotton"})]),first()).invoices[0];assert.equal(o.cents,41500);assert.equal(o.charges.length,2);assert.equal(o.charges[0].cents,0);assert.equal(o.charges[1].units,2);
});
test("missing, ambiguous, voided, wrong-terminal, conflicting-file and blank-pay sources cannot create",()=>{
  const cases=[first().slice(0,2),first([["OTHER",700,"ABCU123456","FILE FILE1",220,""]])];
  for(const change of [[1,702],[5,"10-26-26"],[3,"FILE WRONG"],[4,""]]){const rows=first();rows[2][change[0]]=change[1];cases.push(rows)}
  for(const rows of cases){const i=parseDrays(csv(),rows).invoices[0];assert.ok(i.inputErrors.length);assert.throws(()=>buildPayload(i,PROFILE))}
});
test("duplicate source rows rejected; unrelated FirstStar rows don't alter result",()=>{
  assert.throws(()=>parseDrays(csv([source(),source()]),first()),/Duplicate/);
  assert.deepEqual(parseDrays(csv(),first([["OTHER",700,"XXXX654321","FILE OTHER",500,""]])).invoices,[invoice()]);
});
test("direct rated payload preserves mark/container/file/booking, terminal, zero charge and carrier pay",()=>{
  const i=invoice(),o=order(i);assert.deepEqual(verifyRatedOrder(o,i,PROFILE),[]);
  assert.equal(o.blnum,"MARK1");assert.equal(o.consignee_refno,"ABCU1234567");assert.equal(o.planning_comment,"FILE1");assert.equal(o.ordered_by,"SO-CUSTOMER-1");assert.equal(o.booking_no_sucm,"BOOK1");assert.equal(o.stops[1].location_id,"SAVPORT");assert.equal(o.rate,350);assert.equal(o.movements[0].override_pay_amt,200);
  for(const field of ["override_pay_amt","override_pay_rate","override_paye_rate"]){const bad=structuredClone(o);bad.movements[0][field]=220;assert.ok(verifyRatedOrder(bad,i,PROFILE).length)}
  const wrong=structuredClone(o);wrong.stops[1].location_id="SAVOT";assert.ok(verifyRatedOrder(wrong,i,PROFILE).length);
});
test("duplicate search matches mark AND container; different containers do not suppress a new load",async()=>{
  const i=invoice(),o=order(i);const read=async path=>path.startsWith("/orders/search?")?[{id:o.id}]:o;
  assert.equal((await findDuplicates(read,i,PROFILE)).length,1);o.consignee_refno="DIFFERENT";assert.equal((await findDuplicates(read,i,PROFILE)).length,0);
});
test("create, direct rating and delivery verify exact amounts; delivery preserves charges and pay",async()=>{
  const h=harness();await processInvoice(h.row,h.store,h.vendor);assert.equal(h.row.status,"verified");assert.equal(h.writes.some(w=>w.path.includes("autorate")),false);
  const before=structuredClone(h.order),plan=buildDeliveryPlan(h.order,h.row);await deliverInvoice(h.row,h.store,h.vendor,plan);assert.equal(h.row.status,"delivered");assert.deepEqual(h.order.otherCharges,before.otherCharges);assert.equal(h.order.movements[0].override_pay_amt,200);assert.equal(h.order.ready_to_bill,true);assert.equal(h.order.stops[1].actual_departure,plan.stops[1].departure);
});
test("simultaneous create requests issue only one create; uncertain create cannot retry",async()=>{
  const h=harness();await Promise.allSettled([processInvoice(h.row,h.store,h.vendor),processInvoice(h.row,h.store,h.vendor)]);assert.equal(h.writes.filter(w=>w.path==="/orders/create").length,1);
  const u=harness();u.vendor.write=async()=>{throw Error("timeout")};await assert.rejects(processInvoice(u.row,u.store,u.vendor));assert.equal(u.row.status,"creation_uncertain");await assert.rejects(processInvoice(u.row,u.store,u.vendor),/uncertain/);
});
test("missing movement overrides use matched nonzero dispatch pay; uncertain pay response cannot repeat",async()=>{
  for(const lost of [false,true]){
    const h=harness(),write=h.vendor.write;
    h.vendor.write=async(path,body)=>{
      const result=await write(path,body);
      if(path==="/orders/create")for(const key of ["override_payee_id","override_type","override_units","override_paye_rate","override_pay_rate","override_pay_amt"])delete h.order.movements[0][key];
      if(lost && path.startsWith("/carrierDispatch/setPay/"))throw Error("Lost pay response");
      return result;
    };
    if(lost){await assert.rejects(processInvoice(h.row,h.store,h.vendor));assert.equal(h.row.status,"rating_uncertain");const n=h.writes.length;await assert.rejects(processInvoice(h.row,h.store,h.vendor));assert.equal(h.writes.length,n)}
    else{await processInvoice(h.row,h.store,h.vendor);assert.equal(h.row.status,"verified")}
    assert.equal(h.writes.filter(w=>w.path==="/carrierDispatch/setPay/MOVE1?method=F&units=1&rate=200&carrierPay=200").length,1);
  }
});
test("uncertain delivery stays fenced; reconciliation performs reads only",async()=>{
  const h=harness();await processInvoice(h.row,h.store,h.vendor);const plan=buildDeliveryPlan(h.order,h.row);const real=h.vendor.write;h.vendor.write=async(path,body)=>{await real(path,body);throw Error("lost response")};await assert.rejects(deliverInvoice(h.row,h.store,h.vendor,plan));assert.equal(h.row.status,"delivery_uncertain");
  const n=h.writes.length;await reconcileDelivery(h.row,h.store,h.vendor);assert.equal(h.writes.length,n);assert.equal(h.row.status,"delivery_uncertain");
});
test("dray ledger isolates orders, reuploads, corrected missing-rate previews and source conflicts",async()=>{
  const db=new PGlite();try{
    await db.exec("create role anon;create role authenticated;create role service_role;");
    const file=readdirSync("supabase/migrations").find(n=>n.endsWith("_dray_import_ledger.sql"));await db.exec(readFileSync("supabase/migrations/"+file,"utf8"));
    const repair=readdirSync("supabase/migrations").find(n=>n.endsWith("_dray_created_order_repair.sql"));await db.exec(readFileSync("supabase/migrations/"+repair,"utf8"));
    const i=invoice(),profile=JSON.stringify(PROFILE),digest="a".repeat(64);
    const prep=async(d,inv,status="ready",hash="x")=>(await db.query("select prepare_dray_import($1,$2,$3,$4) id",[d,profile,JSON.stringify([{invoice:inv,status,note:"preview",source_hash:hash,order_id:null}]),"test"])).rows[0].id;
    const blocked={...i,inputErrors:["Missing match"],carrierCents:null};const run=await prep(digest,blocked,"preview_blocked","bad");assert.equal(await prep(digest,blocked),run);
    await prep("b".repeat(64),i);let r=(await db.query("select * from dray_import_orders")).rows;assert.equal(r.length,1);assert.equal(r[0].status,"ready");assert.equal(r[0].invoice.carrierCents,20000);
    await prep("c".repeat(64),{...i,carrierCents:25000},"ready","changed");assert.equal((await db.query("select count(*)::int n from dray_import_items where conflict")).rows[0].n,1);
    const row=r[0];const transition=()=>db.query("select * from transition_dray_import($1,$2,'ready','creating',null,'claim','test')",[row.id,row.version]);assert.equal((await transition()).rows.length,1);assert.equal((await transition()).rows.length,0);
    await assert.rejects(db.query("select * from transition_dray_import($1,1,'rating','delivered',null,'invalid','test')",[row.id]),/Invalid import state transition/);
    const protectedTables=await db.query("select relrowsecurity from pg_class where relname in ('dray_import_orders','dray_import_runs','dray_import_items','dray_import_events')");assert.equal(protectedTables.rows.length,4);assert.ok(protectedTables.rows.every(x=>x.relrowsecurity));
  }finally{await db.close()}
});

test("Olam uses customer SO for Ordered By and booking_no_sucm for booking",()=>{
 const i=parseDrays(csv([source({Shipper:"Olam Cotton"})]),first()).invoices[0];const o=order(i);
 assert.equal(i.customerOrder,"SO-CUSTOMER-1");assert.equal(o.ordered_by,"SO-CUSTOMER-1");assert.equal(o.booking_no_sucm,"BOOK1");assert.deepEqual(verifyRatedOrder(o,i,PROFILE),[]);
 o.booking_no_sucm="WRONG";assert.match(verifyRatedOrder(o,i,PROFILE).join(),/Booking number/);
});

test("all customers use customer SO and separate booking; repair keeps billing intact",async()=>{
 const h=harness();await processInvoice(h.row,h.store,h.vendor);h.row.status="blocked";h.order.ordered_by="BOOK1";delete h.order.booking_no_sucm;for(const k of ["override_payee_id","override_type","override_units","override_paye_rate","override_pay_rate","override_pay_amt"])delete h.order.movements[0][k];
 const charges=structuredClone(h.order.otherCharges),total=h.order.total_charge;await repairCreatedInvoice(h.row,h.store,h.vendor);assert.equal(h.row.status,"verified");assert.equal(h.order.ordered_by,"SO-CUSTOMER-1");assert.equal(h.order.booking_no_sucm,"BOOK1");assert.equal(h.order.movements[0].override_pay_amt,200);assert.deepEqual(h.order.otherCharges,charges);assert.equal(h.order.total_charge,total);assert.equal(h.writes.filter(w=>w.path==="/orders/create").length,1);
});
test("repair refuses unexpected FSC/charge lines without any vendor write",async()=>{
 const h=harness();await processInvoice(h.row,h.store,h.vendor);h.row.status="blocked";h.order.otherCharges.push({...h.order.otherCharges[0],charge_id:"FSC",amount:20});const n=h.writes.length;await assert.rejects(repairCreatedInvoice(h.row,h.store,h.vendor),/Unexpected billing charge/);assert.equal(h.writes.length,n);
});
test("repair only fills missing supplemental pay rate when other fields already match",async()=>{
 const h=harness();await processInvoice(h.row,h.store,h.vendor);h.row.status="blocked";h.order.movements[0].override_pay_rate=null;
 const n=h.writes.length,write=h.vendor.write;h.vendor.write=async(path,body)=>{const r=await write(path,body);if(path.startsWith('/carrierDispatch/'))h.order.movements[0].override_pay_rate=200;return r};
 await repairCreatedInvoice(h.row,h.store,h.vendor);assert.equal(h.row.status,"verified");assert.equal(h.writes.length,n+1);assert.ok(h.writes[n].path.startsWith('/carrierDispatch/setPay/'));
});

test("create omits nested billing lines so McLeod defaults cannot duplicate the supplied chassis",()=>{assert.equal(Object.hasOwn(buildPayload(invoice(),PROFILE),"otherCharges"),false)});
test("automatic customer charge duplicates are removed before carrier setup and never create a second load",async()=>{
 const h=harness(),write=h.vendor.write;h.vendor.write=async(path,body)=>{const r=await write(path,body);if(path==="/orders/create"){h.order.otherCharges.push({...h.order.otherCharges[0],id:"AUTO_DUPLICATE"});h.order.total_charge=620;for(const k of ["override_payee_id","override_type","override_units","override_paye_rate","override_pay_rate","override_pay_amt"])delete h.order.movements[0][k]}return r};
 await processInvoice(h.row,h.store,h.vendor);assert.equal(h.row.status,"verified");assert.equal(h.order.otherCharges.length,1);assert.equal(h.order.total_charge,485);assert.equal(h.order.movements[0].override_pay_amt,200);assert.equal(h.writes.filter(w=>w.path==="/orders/create").length,1);
});
test("repair trims only an exact duplicate approved charge before completing carrier",async()=>{
 const h=harness();await processInvoice(h.row,h.store,h.vendor);h.row.status="blocked";h.order.otherCharges.push({...h.order.otherCharges[0],id:"DUPLICATE"});h.order.total_charge=620;delete h.order.movements[0].override_payee_id;await repairCreatedInvoice(h.row,h.store,h.vendor);assert.equal(h.row.status,"verified");assert.equal(h.order.otherCharges.length,1);assert.equal(h.order.total_charge,485);assert.equal(h.order.movements[0].override_payee_id,"SCMIRIGA");
});
test("billing normalization adds Olam's missing zero invoice line exactly once",()=>{const i=parseDrays(csv([source({Shipper:"Olam Cotton"})]),first()).invoices[0];const o=order(i);o.otherCharges=o.otherCharges.filter(c=>c.amount!==0);const plan=billingNormalizationPayload(o,i,PROFILE,o.id);assert.equal(plan.otherCharges.filter(c=>c.amount===0&&!c.__deleted).length,1);assert.equal(billingNormalizationPayload({...o,...plan},i,PROFILE,o.id),null)});
