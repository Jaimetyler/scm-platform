import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CHECKIN_SITES } from '../lib/inbound/checkin/sites.ts';
const route=new URL('../app/warehouse/gate/[terminal]/[siteCode]/diagnostics/page.tsx',import.meta.url);
const source=ts.transpileModule(readFileSync(route,'utf8'),{fileName:'page.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function load(staff,calls,rows=[]){
 const jsx=(type,props)=>({type,props}); const query={select(){return this;},eq(key,value){calls.push([key,value]);return this;},or(){return this;},order(){return this;},async limit(){return {data:rows};}};
 const modules={'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'a'},'next/navigation':{notFound(){throw Error('NOT_FOUND');}},'@/lib/auth/page':{requireStaffPage:async()=>{if(!staff)throw Error('SIGN_IN');return staff;}},'@/lib/inbound/checkin/sites':{getCheckinSite:(terminal,code)=>CHECKIN_SITES.find(s=>s.terminalSlug===terminal&&s.siteCode===code)},'@/components/platform/PlatformPageHeader':{default:'header'},'@supabase/supabase-js':{createClient(){calls.push('database');return {from:()=>query};}}};
 const module={exports:{}};new Function('require','module','exports',source)(name=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);return module.exports.default;
}
const context={params:Promise.resolve({terminal:'hou',siteCode:'5300'})};
test('check-in diagnostics authenticate and enforce operator terminal before private reads',async()=>{
 let calls=[];await assert.rejects(load(null,calls)(context),/SIGN_IN/);assert.equal(calls.length,0);
 await assert.rejects(load({role:'operator',terminal:'SAV'},calls)(context),/NOT_FOUND/);assert.equal(calls.length,0);
 const before={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
 try{const page=await load({role:'operator',terminal:'HOU'},calls,[{id:'TEST',yard_status:'completed',outside_carrier_override_at:'test',mcleod_lookup_status:'unresolved'}])(context);
 assert.ok(calls.some(v=>Array.isArray(v)&&v[0]==='terminal'&&v[1]==='HOU'));assert.ok(calls.some(v=>Array.isArray(v)&&v[0]==='site_code'&&v[1]==='5300'));
 function nodes(n,type){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(v=>nodes(v,type));return[...(n.type===type?[n]:[]),...nodes(n.props?.children,type)];}
 assert.equal(nodes(page,'details').length,2);assert.ok(nodes(page,'details').every(n=>!n.props.open));assert.equal(nodes(page,'li').length,1);assert.equal(nodes(page,'button').length,0);
 }finally{for(const [key,value] of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
