import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const id='11111111-1111-4111-8111-111111111111';
const stub=({children})=>React.createElement(React.Fragment,null,children);
const link=({children,href})=>React.createElement('a',{href},children);
function load(path,deps) {
 const source=ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',source)(name=>deps[name]??{__esModule:true,default:stub},module,module.exports);
 return module.exports.default;
}
test('driver details open for QR and staff arrivals at 5300 and preserve terminal and missing-record protection',async()=>{
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://fixture.test';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
 let row,staff={role:'operator',terminal:'HOU'},filters=[];
 const db={from(){filters=[];return {select(){return this;},eq(field,value){filters.push([field,value]);return this;},async maybeSingle(){return {data:row,error:null};}};}};
 const page=load('app/warehouse/checkin/[id]/page.tsx',{
  react:React,'react/jsx-runtime':jsx,'next/link':{__esModule:true,default:link},
  'next/navigation':{notFound(){throw new Error('NOT_FOUND');}},
  '@/components/platform/PlatformPageHeader':{__esModule:true,default:({actions})=>React.createElement(React.Fragment,null,actions)},
  '@/lib/auth/page':{requireStaffPage:async()=>staff},
  '@supabase/supabase-js':{createClient:()=>db},
 });
 try {
  for(const source of ['driver_qr','staff']) for(const material of ['cotton','lumber','other']) {
   row={id,terminal:'HOU',site_code:'5300',site_name:'Houston 5300',material_type:material,checkin_source:source,movement_direction:'pickup',driver_name:'Fixture Driver',driver_phone:'555-0100',trucking_company:'Fixture Carrier'};
   const html=renderToStaticMarkup(await page({params:Promise.resolve({id})}));
   assert.match(html,/Fixture Driver/);assert.match(html,/tel:555-0100/);
   assert.match(html,new RegExp(`/warehouse/gate/hou/5300/line\\?arrival=${id}`));
   assert.deepEqual(filters,[['id',id]]);
  }
  row={...row,terminal:'SAV'};
  await assert.rejects(page({params:Promise.resolve({id})}),/NOT_FOUND/);
  staff={role:'admin',terminal:null};
  assert.ok(await page({params:Promise.resolve({id})}));
  row=null;
  await assert.rejects(page({params:Promise.resolve({id})}),/NOT_FOUND/);
  await assert.rejects(page({params:Promise.resolve({id:'invalid'})}),/NOT_FOUND/);
 } finally {
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});
test('Active Line includes a direct driver details link for QR and staff entries',()=>{
 const rows=['driver_qr','staff'].map((source,index)=>({id:`${index+1}1111111-1111-4111-8111-111111111111`,checkin_source:source,checked_in_at:`2026-11-10T1${index}:00:00Z`,yard_status:'waiting',material_type:'lumber',movement_direction:'pickup',driver_name:`Fixture ${source}`}));
 let state=0;
 const react={...React,useLayoutEffect:()=>{},useState(initial){const index=state++;return [index===0?rows:index===1?false:typeof initial==='function'?initial():initial,()=>{}];}};
 const page=load('app/warehouse/gate/[terminal]/[siteCode]/line/page.tsx',{
  react,'react/jsx-runtime':jsx,'next/link':{__esModule:true,default:link},
  'next/navigation':{useParams:()=>({terminal:'hou',siteCode:'5300'})},
  '@/lib/inbound/checkin/sites':{getCheckinSite:()=>({terminal:'HOU',terminalSlug:'hou',siteCode:'5300',siteName:'Houston 5300'})},
  '@/lib/inbound/checkin/geofence':{warehouseDate:()=> '2026-11-10'},
  '@/components/auth/StaffSession':{useCanWrite:()=>true},
  '@/components/warehouse/useVisiblePolling':{useVisiblePolling:()=>({refresh:()=>{}})},
  '@/components/warehouse/OutsideCarrierReview':{canRetryInterruptedLookup:()=>false,canPrepareLegacyLookup:()=>false,checkoutNeedsReview:()=>false,OutsideCarrierMarker:()=>null},
  '@/lib/inbound/checkin/shortage':{cottonShortage:()=>null},
 });
 const html=renderToStaticMarkup(React.createElement(page));
 for(const row of rows) assert.ok(html.includes(`href="/warehouse/checkin/${row.id}"`));
 assert.equal((html.match(/>Driver details<\/a>/g)||[]).length,2);
});
