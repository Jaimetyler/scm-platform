import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const data=[{warehouse:'Savannah',code:'3PL-SYN',name:'Synthetic',otrCode:'SYN',metrics:{otrLoads:1,otrRevenue:1000,otrPay:700,cntrLoads:2,cntrRevenue:600,cntrPay:400,truckingLoads:3,truckingRevenue:1600,truckingPay:1100},months:[{month:'2025-01',truckingLoads:3,truckingRevenue:1600,truckingPay:1100}]},{warehouse:'Dallas',code:'3PL-SYN',name:'Synthetic',otrCode:'SYN',warehouseDataAvailable:false,metrics:{davisLoads:1,davisRevenue:100,davisPay:60,ddrayLoads:1,ddrayRevenue:200,ddrayPay:140,truckingLoads:2,truckingRevenue:300,truckingPay:200},months:[{month:'2025-01',truckingLoads:2,truckingRevenue:300,truckingPay:200}]}];
const sum=k=>Math.round(data.reduce((n,c)=>n+(c.metrics[k]||0),0)*100)/100;
function render(warehouse='All',selected=null){
 const states=[data,false,'',warehouse,'','indicator',selected];
 const react={...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{},useMemo:fn=>fn()};
 const helper={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/reporting/trucking.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(require,helper,helper.exports);
 const mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync('app/reporting/warehouse-intelligence/warehouse-intelligence.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>name==='react'?react:name.endsWith('.css')?{}:name==='@/lib/reporting/trucking'?helper.exports:require(name),mod,mod.exports);
 return renderToStaticMarkup(React.createElement(mod.exports.default));
}
test('original MAIN control and new segment totals reconcile',()=>{
 assert.equal(sum('otrLoads'),1);assert.equal(sum('otrRevenue'),1000);assert.equal(sum('otrPay'),700);
 assert.equal(sum('cntrLoads'),2);assert.equal(sum('davisLoads'),1);assert.equal(sum('ddrayLoads'),1);
 assert.equal(sum('truckingLoads'),5);assert.equal(sum('truckingRevenue'),1900);assert.equal(sum('truckingPay'),1300);
 for(const c of data)for(const k of ['truckingLoads','truckingRevenue','truckingPay'])assert.ok(Math.abs(c.metrics[k]-c.months.reduce((n,m)=>n+(m[k]||0),0))<0.01,`${c.code} ${k}`);
});
test('overview and customer views render all segments; Dallas marks missing warehouse data',()=>{
 const all=render();for(const label of ['MAIN · OTR','CNTR · Direct drays','DAVIS · Trucking','DDRAY · Drays','Dallas'])assert.ok(all.includes(label));
 const dallas=render('Dallas');assert.ok(dallas.includes('Not loaded'));assert.ok(dallas.includes('$100'));assert.ok(!dallas.includes('$1,000'));
 const selected=data.find(c=>c.warehouse==='Dallas').name.trim().toLowerCase();
 const customer=render('Dallas',selected);assert.ok(customer.includes('Connected trucking by revenue code'));assert.ok(customer.includes('Not loaded'));
 const sav=render('Savannah');assert.ok(!sav.includes('aria-pressed="true">Dallas'));
});
test('snapshot stores no raw order IDs or carrier tokens and API remains staff guarded',()=>{
 assert.ok(data.every(c=>!Object.hasOwn(c,'order_id')));
 const route=fs.readFileSync('app/api/reporting/warehouse-intelligence/route.ts','utf8');assert.ok(route.includes('withStaffAccess'));assert.ok(route.includes('private, no-store'));
});
