import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),React=require('react');
const code=ts.transpileModule(fs.readFileSync('app/admin/users/page.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function render(users,updates){const values=[users,'','',false,'','','operator','HOU'],react={...React,useState:()=>[values.shift(),value=>updates.push(value)],useEffect:()=>{}},mod={exports:{}};new Function('require','module','exports',code)(n=>n==='react'?react:n==='@/components/auth/StaffSession'?{useStaff:()=>({id:'SELF'})}:require(n),mod,mod.exports);const nodes=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(n?.props){nodes.push(n);walk(n.props.children);}};walk(mod.exports.default());return nodes;}
test('unsupported legacy role is explicit and cannot appear as administrator without a selection',()=>{
 const users=[{id:'LEGACY',email:'legacy@example.test',name:'Synthetic legacy',role:'financial',terminal:null,status:'active'}],updates=[];
 const nodes=render(users,updates),select=nodes.find(n=>n.type==='select'&&n.props['aria-label']==='Role for legacy@example.test');assert.equal(select.props.value,'financial');
 const legacy=nodes.find(n=>n.type==='option'&&n.props.value==='financial');assert.ok(legacy.props.disabled);assert.ok(legacy.props.children.includes('financial'));
 const save=nodes.find(n=>n.type==='button'&&n.props.children==='Save access');assert.ok(save.props.disabled);
 select.props.onChange({target:{value:'admin'}});const changed=updates[0](users);const updated=render(changed,[]);assert.ok(!updated.find(n=>n.type==='option'&&n.props.value==='financial'));assert.equal(updated.find(n=>n.type==='select'&&n.props['aria-label']==='Role for legacy@example.test').props.value,'admin');assert.equal(updated.find(n=>n.type==='button'&&n.props.children==='Save access').props.disabled,false);
});
