import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { warehouseDayRange } from '../lib/warehouse/day-activity.ts';
test('daily sheet reads every page, includes completed activity and exposes stored arrival numbers without McLeod enrichment',async()=>{
 const queries=[];
 const database={from(){const q={select(value){this.fields=value;return this;},eq(){return this;},in(){return this;},or(value){this.filter=value;return this;},order(){return this;},async range(start,end){queries.push({start,end,filter:this.filter,fields:this.fields});return {data:Array.from({length:start===0?1000:1},(_,i)=>({id:`row-${start+i}`,yard_status:'completed',arrival_number:{queue_day:'2026-11-09',queue_number:start+i+1}})),error:null};}};return q;}};
 const dependencies={
  '@/lib/warehouse/day-activity':{warehouseDayRange},
  'next/server':{NextResponse:Response},
  '@supabase/supabase-js':{createClient:()=>database},
  '@/lib/auth/guard':{withStaffAccess:handler=>handler},
  '@/lib/inbound/checkin/sites':{CHECKIN_SITES:[{terminal:'HOU',siteCode:'5300'}]},
  '@/lib/inbound/checkin/lookup-failure':{outsideCarrierOverrideEligible:()=>false,canPrepareMcleodLookup:()=>false},
  '@/lib/inbound/checkin/display-carrier':{enrichDisplayCarriers:async(rows,line)=>{assert.equal(line,false);return rows;}},
  '@/lib/http/dependency':{DependencyError:class extends Error{}},
  '@/lib/inbound/checkin/yard-stop':{YardStopError:class extends Error{}},
 };
 const source=ts.transpileModule(readFileSync(new URL('../app/api/warehouse/domestic-queue/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',source)(name=>dependencies[name]??{},module,module.exports);
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 try{
  const response=await module.exports.GET(new Request('https://scm.test/api/warehouse/domestic-queue?terminal=HOU&siteCode=5300&view=day'));
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.rows.length,1001);assert.equal(result.rows[1000].queue_number,1001);
  assert.equal(queries.length,2);assert.match(queries[0].filter,/physical_departed_at/);assert.match(queries[0].filter,/yard_completed_at/);assert.match(queries[0].filter,/yard_status.in/);assert.match(queries[0].fields,/warehouse_arrival_numbers/);
 }finally{
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});
