import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as customers from '../lib/dray/booking-customers.ts';
import * as sites from '../lib/inbound/checkin/sites.ts';
import * as limit from '../lib/http/map-limit.ts';
const require=createRequire(import.meta.url);
function route(customer,rates=[],bookingOrders=[]){
 const queried=[];const called=[];
 const db={from:table=>({select(){return this;},eq(key,value){queried.push({table,key,value});return this;},async in(key,value){queried.push({table,key,value});return {data:rates,error:null};},neq(){return this;},async maybeSingle(){return {data:table==='cotton_outbound_bookings'?{terminal:'DAL',site_code:'SCMDDETX',customer,booking_number:'2343518850'}:null,error:null};},async limit(){return {data:[{mark:'W0282'}],error:null};}})};
 const mod={exports:{}};
 const code=ts.transpileModule(readFileSync('app/api/warehouse/outbound/bookings/[id]/charges/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=n=>n==='@/lib/auth/guard'?{withStaffAccess:f=>f}:n==='@/lib/auth/session'?{staffDatabase:()=>db}:n==='@/lib/dray/booking-customers'?customers:n==='@/lib/inbound/checkin/sites'?sites:n==='@/lib/http/map-limit'?limit:n==='@/lib/dray/server'?{vendor:readonly=>{assert.equal(readonly,true);return {read:async()=>({})};}}:n==='@/lib/warehouse/outbound/planning-info'?{readDallasBookingOrders:async(read,number)=>{assert.equal(number,'2343518850');return bookingOrders;}}:n==='@/lib/dray/booking-charges'?{bookingOrderMarks:order=>order.blnum==='W0282'?['W0282']:[],bookingOrderCharges:order=>order,readBookingMarkCharges:async(read,site,mark,signal,ids)=>{called.push(ids);return [];}}:require(n);
 new Function('require','module','exports',code)(local,mod,mod.exports);return {get:mod.exports.GET,queried,called};
}
const request=()=>new Request('https://example.test/api/warehouse/outbound/bookings/11111111-1111-4111-8111-111111111111/charges');
const params={params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})};
test('Olam/ED&F charge lookup runs without Bunge rates and passes only that customer billing IDs',async()=>{
 for(const name of ['Olam Agri Americas Inc','ED&F Man Cotton']){
  const r=route(name);const response=await r.get(request(),params);const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.approvalRate,null);assert.equal(data.negotiatedFuel,false);
  assert.deepEqual(r.called[0],customers.bookingChargeCustomer(name).ids);
  assert.equal(r.queried.find(q=>q.table==='customer_service_rates'&&q.key==='customer_code').value,customers.bookingChargeCustomer(name).code);
 }
});
test('Bunge retains its own required allowance; unknown customers never start a vendor lookup',async()=>{
 const missing=route('Bunge USA Agriculture LLC');assert.equal((await missing.get(request(),params)).status,503);
 const known=route('Bunge USA Agriculture LLC',[{site_code:'',included_chassis_days:1,chassis_daily_rate:45,fuel_mode:'base_plus_fsc',base_rate:null}]);const response=await known.get(request(),params);const data=await response.json();
 assert.deepEqual(data.approvalRate,{includedChassisDays:1,chassisDailyRate:45,fuelMode:'base_plus_fsc',baseRate:null});assert.equal(data.negotiatedFuel,true);
 const unknown=route('Unknown customer');assert.equal((await unknown.get(request(),params)).status,404);assert.equal(unknown.called.length,0);
});

test('exact booking orders show charges even when their mark cannot be verified', async()=>{
 const matched={id:'401',blnum:'W0282'}, unmatched={id:'402',blnum:'SO-ONLY'};
 const r=route('Olam Agri Americas Inc',[],[matched,unmatched]);
 const response=await r.get(request(),params);
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).results,[
  {mark:'W0282',orders:[matched]},
  {mark:'Booking match · mark unverified',orders:[unmatched]},
 ]);
 assert.equal(r.called.length,0);
});

test('Dallas 2119 uses its configured all-in rate ahead of the terminal default', async () => {
 const r=route('Olam Agri Americas Inc',[
  {site_code:'',included_chassis_days:1,chassis_daily_rate:45,fuel_mode:'base_plus_fsc',base_rate:null},
  {site_code:'SCMDDETX',included_chassis_days:2,chassis_daily_rate:35,fuel_mode:'all_in',base_rate:545},
 ]);
 const data=await (await r.get(request(),params)).json();
 assert.deepEqual(data.approvalRate,{includedChassisDays:2,chassisDailyRate:35,fuelMode:'all_in',baseRate:545});
 assert.equal(data.negotiatedFuel,false);
});
