import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
test('checked-out trucks render in arrival order among active trucks with domestic daily numbers',()=>{
  const rows=[
    {id:'third',checked_in_at:'2026-11-10T15:00:00Z',yard_status:'waiting',freight_number:3,queue_number:14,driver_name:'ThirdDriver'},
    {id:'second',checked_in_at:'2026-11-10T14:00:00Z',yard_status:'completed',physical_departed_at:'2026-11-10T16:00:00Z',freight_number:2,queue_number:9,driver_name:'SecondDriver'},
    {id:'first',checked_in_at:'2026-11-10T13:00:00Z',yard_status:'waiting',freight_number:1,queue_number:4,driver_name:'FirstDriver'},
  ].map(row=>({...row,material_type:'lumber',movement_direction:'pickup',reference_number:row.id,updated_at:row.checked_in_at}));
  let stateIndex=0;
  const react={...React,useLayoutEffect:()=>{},useEffect:()=>{},useState(initial){const index=stateIndex++;return [index===0?rows:index===1?false:typeof initial==='function'?initial():initial,()=>{}];}};
  const stub=({children})=>React.createElement(React.Fragment,null,children);
  const deps={react,'react/jsx-runtime':awaitableJsx,
    'next/navigation':{useParams:()=>({terminal:'houston',siteCode:'5300'})},
    'next/link':{__esModule:true,default:stub},
    '@/lib/inbound/checkin/geofence':{warehouseDate:()=> '2026-11-10'},
    '@/lib/inbound/checkin/sites':{getCheckinSite:()=>({terminal:'HOU',terminalSlug:'houston',siteCode:'5300',siteName:'McKinney',materials:['cotton','lumber','other']})},
    '@/components/auth/StaffSession':{useCanWrite:()=>true},
    '@/components/warehouse/useVisiblePolling':{useVisiblePolling:()=>({refresh:()=>{}})},
  };
  const source=ts.transpileModule(readFileSync(new URL('../app/warehouse/gate/[terminal]/[siteCode]/domestic/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',source)(name=>deps[name]??{__esModule:true,default:stub},module,module.exports);
  const html=renderToStaticMarkup(React.createElement(module.exports.default));
  assert.ok(html.indexOf('FirstDriver')<html.indexOf('SecondDriver'));
  assert.ok(html.indexOf('SecondDriver')<html.indexOf('ThirdDriver'));
  assert.match(html,/Checked out/);assert.doesNotMatch(html,/Completed \/ removed today/);
  const thirdRow=html.slice(html.lastIndexOf('<tr',html.indexOf('ThirdDriver')),html.indexOf('ThirdDriver'));
  assert.match(thirdRow,/<td[^>]*>3<\/td>/);assert.doesNotMatch(thirdRow,/<td[^>]*>14<\/td>/);
});
import * as awaitableJsx from 'react/jsx-runtime';
