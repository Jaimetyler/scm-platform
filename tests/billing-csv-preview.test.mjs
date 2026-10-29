import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('actual preview accepts TotalCharges and ignores report subtotals; missing amount column is rejected',async()=>{
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
 try {
 const sb={from(){return {select(){return this},eq(){return this},then(resolve){resolve({data:[{tariff_id:6,mcleod_code:'DCS',description:'Storage'}],error:null})}}}};
 const mod={exports:{}};
 const source=ts.transpileModule(readFileSync('app/api/order-charges/preview/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const helper={exports:{}};new Function('exports',ts.transpileModule(readFileSync('lib/billing/dallas-report-location.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(helper.exports);
 const local=name=>name==='@/lib/billing/dallas-report-location'?helper.exports:name==='@/lib/auth/guard'?{withStaffAccess:x=>x}:name==='@supabase/supabase-js'?{createClient:()=>sb}:name==='@/lib/billing/dallas-order-lookup'?{validateDallasLocation(){},findDallasBillingOrders:async()=>[{id:'synthetic',revenue_code_id:'DLOCA'}]}:require(name);
 new Function('require','module','exports',source)(local,mod,mod.exports);
 for(const header of ['TotalCharges','Total Charges']) {
 const csvText=`Report,,,,,,\n,,Shipping Order #,Tariff ID,Description,Quantity,${header}\n,,100,006,Storage,3,12.34\n,,100,,,,12.34\n,,,,,,12.34`;
 const response=await mod.exports.POST({json:async()=>({terminal:'DAL',location:'SCMDDATX',csvText})});const data=await response.json();
 assert.equal(data.count,1);assert.equal(data.preview[0].charges.length,1);assert.equal(data.preview[0].charges[0].amount,12.34);
 }
 const conflict=await mod.exports.POST({json:async()=>({terminal:'DAL',location:'SCMDDETX',csvText:'Supply Chain - Dallas 2 (843001),,,,\nShipping Order #,Description,Quantity,TotalCharges'})});assert.equal(conflict.status,400);
 assert.equal(helper.exports.dallasReportLocation('Supply Chain Management Dallas (875260),,,,\n'), 'SCMDDETX');
 assert.equal(helper.exports.dallasReportLocation('Unknown Dallas (999999),,,,\n'),null);
 const response=await mod.exports.POST({json:async()=>({terminal:'DAL',location:'SCMDDATX',csvText:'Shipping Order #,Description,Quantity\n100,Storage,3'})});assert.equal(response.status,400);
 } finally {if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});
