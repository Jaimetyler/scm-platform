import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { validatePickupAcceptance, PICKUP_AGREEMENT_VERSION, PICKUP_TERMS } from '../lib/inbound/checkin/pickup-agreement.ts';
import { publicCheckinRow } from '../lib/inbound/checkin/public-row.ts';
const signed = () => ({version:PICKUP_AGREEMENT_VERSION,language:'en',printedName:'TEST DRIVER',trailerNumber:'TEST-TRAILER',productDescription:'Lumber',pickupNumber:'TEST-PU',referencePo:'TEST-PO',acknowledged:true,electronicConsent:true,strokes:[[[.1,.2],[.3,.4],[.5,.2]]]});
test('pickup agreement requires current terms, consent, complete fields and nonempty bounded signature',()=>{
 assert.equal(validatePickupAcceptance(signed()).version,PICKUP_AGREEMENT_VERSION);
 assert.equal(validatePickupAcceptance({...signed(),language:'es'}).language,'es');
 for(const patch of [{version:'old'},{language:'fr'},{acknowledged:false},{electronicConsent:false},{printedName:''},{trailerNumber:''},{productDescription:''},{pickupNumber:''},{referencePo:''},{strokes:[]},{strokes:[[[.2,.2],[.2,.2],[.2,.2]]]},{strokes:[[[NaN,.2],[.3,.4],[.5,.2]]]},{strokes:[[[1.1,.2],[.3,.4],[.5,.2]]]},{strokes:[Array(4001).fill([.1,.2])]}]) assert.throws(()=>validatePickupAcceptance({...signed(),...patch}));
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
