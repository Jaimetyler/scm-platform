import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as agreementModule from '../lib/inbound/checkin/pickup-agreement.ts';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { validatePickupAcceptance, PICKUP_AGREEMENT_VERSION, PICKUP_TERMS } from '../lib/inbound/checkin/pickup-agreement.ts';
import { publicCheckinRow } from '../lib/inbound/checkin/public-row.ts';
const signed = () => ({version:PICKUP_AGREEMENT_VERSION,language:'en',printedName:'TEST DRIVER',trailerNumber:'TEST-TRAILER',productDescription:'Lumber',pickupNumber:'TEST-PU',referencePo:'TEST-PO',acknowledged:true,electronicConsent:true,strokes:[[[.1,.2],[.3,.4],[.5,.2]]]});
test('pickup agreement requires current terms, consent and nonempty bounded signature',()=>{
 assert.equal(validatePickupAcceptance(signed()).version,PICKUP_AGREEMENT_VERSION);
 assert.equal(validatePickupAcceptance({...signed(),language:'es'}).language,'es');
 for(const patch of [{version:'old'},{language:'fr'},{acknowledged:false},{electronicConsent:false},{strokes:[]},{strokes:[[[.2,.2],[.2,.2],[.2,.2]]]},{strokes:[[[NaN,.2],[.3,.4],[.5,.2]]]},{strokes:[[[1.1,.2],[.3,.4],[.5,.2]]]},{strokes:[Array(4001).fill([.1,.2])]}]) assert.throws(()=>validatePickupAcceptance({...signed(),...patch}));
 for(const language of ['en','es']) {assert.equal(PICKUP_TERMS[language].clauses.length,4);assert.match(PICKUP_TERMS[language].clauses[0],/\$400/);assert.match(PICKUP_TERMS[language].clauses[0],/8/);}
 const row=publicCheckinRow({id:'TEST',pickup_agreement:signed()}); assert.equal(row.has_pickup_agreement,true);assert.equal('pickup_agreement' in row,false);
});
test('database snapshot is atomic, timestamped and immutable while normal receiving remains editable',async()=>{
 const db=new PGlite();
 try {
  await db.exec("create role anon; create role authenticated; create role service_role; create table public.inbound_checkin_rows(id uuid primary key, movement_direction text, checkin_source text, driver_name text); revoke all on public.inbound_checkin_rows from public,anon,authenticated; grant select,insert,update,delete on public.inbound_checkin_rows to service_role; alter table public.inbound_checkin_rows enable row level security;");
  await db.exec(readFileSync(new URL('../supabase/migrations/20261027133220_pickup_agreements.sql',import.meta.url),'utf8'));
  const id='11111111-1111-4111-8111-111111111111';const snap={...signed(),terms:PICKUP_TERMS.en,acceptedAt:'1900-01-01'};
  await db.query("insert into inbound_checkin_rows values($1,'pickup','driver_qr','TEST',$2)",[id,JSON.stringify(snap)]);
  const saved=(await db.query('select pickup_agreement from inbound_checkin_rows where id=$1',[id])).rows[0].pickup_agreement;
  assert.notEqual(saved.acceptedAt,'1900-01-01'); assert.deepEqual(saved.terms,PICKUP_TERMS.en);
  await assert.rejects(db.query("update inbound_checkin_rows set pickup_agreement='{}' where id=$1",[id]),/cannot be changed/);
  await assert.rejects(db.query('delete from inbound_checkin_rows where id=$1',[id]),/must be retained/);
  await db.query("update inbound_checkin_rows set driver_name='CORRECTED' where id=$1",[id]);
  assert.deepEqual((await db.query('select pickup_agreement from inbound_checkin_rows where id=$1',[id])).rows[0].pickup_agreement,saved);
  await assert.rejects(db.query("insert into inbound_checkin_rows values($1,'pickup','driver_qr','TEST',$2)",[id,JSON.stringify(snap)]),/duplicate key/);
  await assert.rejects(db.query("insert into inbound_checkin_rows values('22222222-2222-4222-8222-222222222222','delivery','driver_qr','TEST',$1)",[JSON.stringify(snap)]),/Invalid pickup/);
  await assert.rejects(db.query("insert into inbound_checkin_rows values('22222222-2222-4222-8222-222222222222','pickup','driver_qr','TEST',$1)",[JSON.stringify({...snap,version:null})]),/Invalid pickup/);
  await db.exec("set role anon"); await assert.rejects(db.query('select pickup_agreement from inbound_checkin_rows'),/permission denied/); await db.exec('reset role');
  await db.exec("set role authenticated"); await assert.rejects(db.query('select pickup_agreement from inbound_checkin_rows'),/permission denied/); await db.exec('reset role');
  assert.equal((await db.query('select count(*) from inbound_checkin_rows')).rows[0].count,1);
 } finally {await db.close();}
});


test('popup locks background scrolling and pad touch gestures, captures strokes, and restores scroll on close',()=>{
 const source=ts.transpileModule(readFileSync(new URL('../components/warehouse/PickupAgreement.tsx',import.meta.url),'utf8'),{fileName:'PickupAgreement.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const slots=[];let cursor=0,value={...signed(),strokes:[]},tree,effects=[];
 const document={body:{style:{overflow:'auto'}},documentElement:{style:{overflow:''}}};const listeners=new Map();const modal={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const pad={addEventListener(name,fn,options){listeners.set(name,{fn,options});},removeEventListener(name){listeners.delete(name);}};
 const jsx=(type,props)=>({type,props});const modules={'react':{
 useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;render();}];},
 useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 },'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/inbound/checkin/pickup-agreement':agreementModule};const module={exports:{}};
 new Function('require','module','exports','document',source)(name=>{assert.ok(name in modules);return modules[name];},module,module.exports,document);
 function nodes(node,type){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n,type));return [...(node.type===type?[node]:[]),...nodes(node.props?.children,type)];}
 function render(){cursor=0;effects=[];tree=module.exports.default({value,language:'en',onChange(next){value=next;render();}});nodes(tree,'dialog')[0].props.ref.current=modal;nodes(tree,'div').find(n=>n.props.ref).props.ref.current=pad;const todo=effects;todo.forEach(fn=>fn());}
 const event=(x,y)=>({preventDefault(){},pointerId:1,clientX:x,clientY:y,currentTarget:{setPointerCapture(){},getBoundingClientRect(){return {left:0,top:0,width:600,height:220};}}});
 render();assert.equal(modal.open,false);assert.equal(nodes(tree,'input').length,2);assert.ok(nodes(tree,'input').every(n=>n.props.type==='checkbox'));
 nodes(tree,'button')[0].props.onClick();assert.equal(modal.open,true);assert.equal(document.body.style.overflow,'hidden');assert.equal(document.documentElement.style.overflow,'hidden');
 let prevented=false;listeners.get('touchmove').fn({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(listeners.get('touchmove').options.passive,false);
 nodes(tree,'svg')[0].props.onPointerDown(event(60,44));nodes(tree,'svg')[0].props.onPointerMove(event(180,88));nodes(tree,'svg')[0].props.onPointerMove(event(300,44));nodes(tree,'svg')[0].props.onPointerUp();
 assert.deepEqual(value.strokes,[[[.1,.2],[.3,.4],[.5,.2]]]);assert.equal(value.acknowledged,false);assert.equal(value.electronicConsent,false);
 nodes(tree,'input')[0].props.onChange({target:{checked:true}});nodes(tree,'input')[1].props.onChange({target:{checked:true}});
 assert.equal(validatePickupAcceptance(value).strokes.length,1);
 nodes(tree,'button').at(-1).props.onClick();assert.equal(modal.open,false);assert.equal(document.body.style.overflow,'auto');assert.equal(document.documentElement.style.overflow,'');
 nodes(tree,'button')[0].props.onClick();nodes(tree,'button').find(n=>n.props.children==='Clear signature').props.onClick();assert.equal(value.strokes.length,0);assert.equal(value.acknowledged,false);
 nodes(tree,'button').at(-1).props.onClick();assert.equal(modal.open,true);assert.ok(nodes(tree,'p').some(n=>n.props.role==='alert'));
 nodes(tree,'dialog')[0].props.onCancel({preventDefault(){}});assert.equal(modal.open,false);assert.equal(document.body.style.overflow,'auto');
 for(const slot of slots)slot?.cleanup?.();assert.equal(listeners.size,0);
});
