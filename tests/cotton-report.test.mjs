import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function helper(){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/reporting/cotton.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(require,mod,mod.exports);return mod.exports;}
const data=[
 {warehouse:'Savannah',code:'SYN',name:'Synthetic cotton',accounts:['ECOT-SYN','SYN'],codes:['LOCAL','MAIN'],relationshipReview:false,metrics:{warehouseOrders:1,warehouseRevenue:100,otrOrders:2,otrRevenue:200,otrPay:120,otrRevenueWithPay:200},months:[{month:'2025-01',warehouseOrders:1,warehouseRevenue:100,otrOrders:2,otrRevenue:200,otrPay:120,otrRevenueWithPay:200}]},
 {warehouse:'Dallas',code:'DAL',name:'Synthetic Dallas',accounts:['DAL'],codes:['DLOCA','DDRAY'],relationshipReview:false,metrics:{warehouseOrders:1,warehouseRevenue:80,warehouseDetailedOrders:1,warehouseStorage:50,warehouseHandling:20,warehouseOther:10,drayOrders:1,drayRevenue:50,drayPay:25,drayRevenueWithPay:50},months:[{month:'2025-01',warehouseRevenue:80,drayRevenue:50,drayPay:25,drayRevenueWithPay:50}]},
 {warehouse:'Unassigned',code:'REMOTE',name:'Synthetic remote',accounts:['REMOTE'],codes:['MAIN'],relationshipReview:false,metrics:{otrOrders:1,otrRevenue:30,otrPayMissing:1},months:[{month:'2025-01',otrRevenue:30,otrPayMissing:1}]},
];
function render(terminal='All',selected=null,query=''){
 const states=[data,false,'',terminal,query,'contribution',selected];
 const react={...React,useState:()=>[states.shift(),()=>{}],useMemo:fn=>fn(),useEffect:()=>{}};
 const mod={exports:{}};const source=ts.transpileModule(fs.readFileSync('app/reporting/cotton-intelligence/cotton-intelligence.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',source)(n=>n==='react'?react:n==='next/link'?{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}:n.endsWith('.css')?{}:n==='@/lib/reporting/cotton'?helper():require(n),mod,mod.exports);
 return renderToStaticMarkup(React.createElement(mod.exports.default));
}
test('warehouse billing is not carrier GP; missing-pay revenue never becomes assumed GP',()=>{
 const h=helper();assert.equal(h.cottonServices({warehouseRevenue:100})[0].gp,null);
 assert.equal(h.cottonTransportGP({otrRevenue:200,otrRevenueWithPay:150,otrPay:100,otrPayMissing:1}),50);
 assert.equal(h.cottonContribution({warehouseRevenue:100,otrRevenueWithPay:150,otrPay:100}),150);
});
test('all terminals, customer detail and Dallas charge detail render correct scope',()=>{
 const all=render();assert.ok(all.includes('Cotton Intelligence'));assert.ok(all.includes('Brokerage'));assert.ok(!all.includes('Unassigned'));assert.ok(all.includes('Synthetic cotton'));assert.ok(all.includes('Synthetic remote'));assert.ok(all.includes('lack verified current-movement pay'));
 const selected=render('Savannah','SYN');assert.ok(selected.includes('Pending charge detail'));assert.ok(selected.includes('$200.00'));assert.ok(selected.includes('ECOT-SYN'));
 const dallas=render('Dallas','DAL');assert.ok(dallas.includes('$50.00'));assert.ok(dallas.includes('$20.00'));assert.ok(dallas.includes('$10.00'));assert.ok(!dallas.includes('Pending charge detail</td>'));
 const noActivity=render('Dallas','SYN');assert.ok(noActivity.includes('No activity for this customer'));
 const search=render('All',null,'REMOTE');assert.ok(search.includes('Synthetic remote'));assert.ok(!search.includes('>Synthetic cotton</button>'));
});
test('financial API is staff guarded and data is never imported into the client',()=>{
 const api=fs.readFileSync('app/api/reporting/cotton-intelligence/route.ts','utf8');assert.ok(api.includes('withStaffAccess'));assert.ok(api.includes('private, no-store'));assert.ok(api.includes('status:503'));
 const client=fs.readFileSync('app/reporting/cotton-intelligence/cotton-intelligence.tsx','utf8');assert.ok(!client.includes('data.json'));assert.ok(client.includes("cache:'no-store'"));
});
