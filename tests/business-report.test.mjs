import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const data=[
 {warehouse:'Savannah',scope:'Cotton',code:'C',name:'Synthetic combined',accounts:['C','EC'],codes:['LOCAL','MAIN'],relationshipReview:false,metrics:{warehouseOrders:1,warehouseDetailedOrders:1,warehouseRevenue:100,warehouseHandling:60,warehouseStorage:40,otrOrders:1,otrRevenue:200,otrPay:100,otrRevenueWithPay:200},months:[{month:'2025-01',warehouseOrders:1,warehouseDetailedOrders:1,warehouseRevenue:100,warehouseHandling:60,warehouseStorage:40,otrOrders:1,otrRevenue:200,otrPay:100,otrRevenueWithPay:200}]},
 {warehouse:'Savannah',scope:'Non-Cotton',code:'C',name:'Synthetic combined',accounts:['C','3PL'],codes:['TERRY'],relationshipReview:false,metrics:{warehouseOrders:1,warehouseDetailedOrders:1,warehouseRevenue:50,warehouseHandling:50,otrOrders:1,otrRevenue:300,otrPay:200,otrRevenueWithPay:300},months:[{month:'2025-01',warehouseOrders:1,warehouseDetailedOrders:1,warehouseRevenue:50,warehouseHandling:50,otrOrders:1,otrRevenue:300,otrPay:200,otrRevenueWithPay:300}]},
 {warehouse:'Savannah',scope:'Unclassified',code:'C',name:'Synthetic combined',accounts:['C'],codes:['CONTRACT'],relationshipReview:false,metrics:{warehouseRevenue:25,warehouseStorage:25,contractStorage:25,contractDocuments:1,unclassifiedContractRevenue:25},months:[{month:'2025-01',warehouseRevenue:25,warehouseStorage:25,contractStorage:25,contractDocuments:1,unclassifiedContractRevenue:25}]},
 {warehouse:'Brokerage',scope:'Non-Cotton',code:'B',name:'Synthetic brokerage',accounts:['B'],codes:['CNTR'],relationshipReview:false,metrics:{drayOrders:1,drayRevenue:10000,drayPay:8000,drayRevenueWithPay:10000},months:[{month:'2025-01',drayOrders:1,drayRevenue:10000,drayPay:8000,drayRevenueWithPay:10000}]},
];
const compiledClient=ts.transpileModule(fs.readFileSync('app/reporting/business-intelligence/business-intelligence.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
let cachedHelper;
function render(unit='All',scope='All',selected=null,onSet=()=>{},tree=false,records=data){
 const states=[records,false,'',unit,'','contribution',selected,scope],react={...React,useState:()=>[states.shift(),onSet],useMemo:f=>f(),useEffect:()=>{}};
 function helper(){if(cachedHelper)return cachedHelper;const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/reporting/cotton.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(require,mod,mod.exports);cachedHelper=mod.exports;return cachedHelper;}
 const mod={exports:{}};const source=compiledClient;
 new Function('require','module','exports',source)(n=>n==='react'?react:n==='next/link'?{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}:n.endsWith('.css')?{}:n==='@/lib/reporting/cotton'?helper():require(n),mod,mod.exports);
 return tree?mod.exports.default():renderToStaticMarkup(React.createElement(mod.exports.default));
}
test('combined customer drilldown rolls scopes into each unit once and keeps monthly detail',()=>{
 const selected=render('All','All','C');assert.ok(selected.includes('Monthly activity'));assert.ok(selected.includes('Local drayage'));assert.ok(selected.includes('Direct drayage · CNTR / DDRAY'));assert.ok(selected.includes('$175.00'));assert.ok(selected.includes('$500.00'));assert.ok(selected.includes('3PL'));assert.ok(selected.includes('Contract storage (included in Storage)'));
 assert.equal((selected.match(/>Savannah<\/button>/g)||[]).length,2); // filter + one combined unit comparison row
 const cotton=render('All','Cotton','C');assert.ok(cotton.includes('$100.00'));assert.ok(cotton.includes('$200.00'));assert.ok(!cotton.includes('$500.00'));
 const non=render('All','Non-Cotton','C');assert.ok(non.includes('$300.00'));assert.ok(!non.includes('>EC ·'));
 const unclassified=render('All','Unclassified','C');assert.ok(unclassified.includes('$25.00'));assert.ok(!unclassified.includes('Pending charge detail</td>'));
 const pending=render('All','All','P',()=>{},false,[{...data[0],code:'P',name:'Pending cost account',metrics:{warehouseTruckBillingRevenue:50,localDrayRevenue:50,drayRevenue:50,localDrayPayMissing:1,drayPayMissing:1},months:[]}]);assert.ok(pending.includes('Pending cost'));
 const brokerage=render('Brokerage');assert.ok(brokerage.includes('Synthetic brokerage'));assert.ok(!brokerage.includes('>Synthetic combined</button>'));
});
test('combined row and view button select the customer',()=>{
 const calls=[],nodes=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(n&&typeof n==='object'&&n.props){nodes.push(n);walk(n.props.children);}};walk(render('All','All',null,v=>calls.push(v),true));
 nodes.find(n=>n.type==='tr'&&n.props['aria-label']==='Open customer Synthetic combined').props.onClick();nodes.find(n=>n.type==='button'&&n.props['aria-label']==='View customer Synthetic combined').props.onClick();assert.deepEqual(calls,['C','C']);
});
test('combined endpoint is separate, staff guarded, private, and never imports financial JSON',()=>{
 const api=fs.readFileSync('app/api/reporting/business-intelligence/route.ts','utf8');assert.ok(api.includes('withStaffAccess'));assert.ok(api.includes('private, no-store'));assert.ok(api.includes('business-intelligence-20261028-v1'));
 const client=fs.readFileSync('app/reporting/business-intelligence/business-intelligence.tsx','utf8');assert.ok(client.includes('/api/reporting/business-intelligence'));assert.ok(!client.includes('data.json'));assert.ok(client.includes('Remaining non-cotton local trucking'));
});
// This opt-in path is used only for private runtime QA, not repository fixtures.
if(process.env.PRIVATE_BUSINESS_QA){const records=JSON.parse(fs.readFileSync(process.env.PRIVATE_BUSINESS_QA,'utf8'));let checks=0;for(const unit of ['All','Savannah','Houston','Dallas','Brokerage','Allocation review'])for(const scope of ['All','Cotton','Non-Cotton','Unclassified']){const html=render(unit,scope,null,()=>{},false,records);assert.ok(!html.includes('NaN'));checks++;for(const code of new Set(records.filter(x=>(unit==='All'||x.warehouse===unit)&&(scope==='All'||x.scope===scope)).map(x=>x.code))){const detail=render(unit,scope,code,()=>{},false,records);assert.ok(!detail.includes('NaN'));assert.ok(detail.includes('Monthly activity'));checks++;}}process.stdout.write(JSON.stringify({privateRenderChecks:checks})+'\n');}
