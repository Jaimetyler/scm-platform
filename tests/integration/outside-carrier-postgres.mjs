// Native PostgreSQL only. Never connects to an existing database or reads DB credentials.
// Requires isolated PostgreSQL binaries and pg in --tooling (default /tmp/scm-pg-tooling).
// Starts/stops its own loopback-only cluster; no existing connection string is accepted.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const tooling = resolve(option('--tooling', '/tmp/scm-pg-tooling'));
const pgRoot = resolve(option('--pg-root', join(tooling, 'package/native')));
const { default: pg } = await import(pathToFileURL(join(tooling, 'node_modules/pg/lib/index.js')));
pg.types.setTypeParser(1184, value => value); // Preserve microsecond revision precision, like PostgREST.
const root = resolve(import.meta.dirname, '../..');
const temp = mkdtempSync(join(tmpdir(), 'scm-concurrency-'));
const environment = { PATH: process.env.PATH ?? '/usr/bin:/bin', LD_LIBRARY_PATH: join(pgRoot, 'lib'), LANG:'C', TZ:'UTC' };
const binary = (name, argv, quiet = false) => {
  const result = spawnSync(join(pgRoot,'bin',name),argv,{env:environment,encoding:'utf8',timeout:60000});
  if(result.status !== 0) throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
  if(!quiet) process.stdout.write(result.stdout);
  return result.stdout;
};
const listener = createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port; await new Promise(r=>listener.close(r));
const connection = {host:'127.0.0.1',port,user:'scm_fixture',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:3000};
const clients = new Set();
async function client(label='fixture') {
  const c=new pg.Client({...connection,application_name:`scm-test-${label}`});
  c.on('error',()=>{}); await c.connect(); clients.add(c);
  await c.query("set statement_timeout='12s'; set lock_timeout='10s'; set deadlock_timeout='100ms'");
  c.pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;
  return c;
}
const scalar=async(c,sql,params=[]) => (await c.query(sql,params)).rows[0]?.value;
const successes=[];

async function scenario(name,body) {
  const began=performance.now(); await body();
  const entry={name,status:'passed',durationMs:Math.round(performance.now()-began)};
  successes.push(entry); console.log(JSON.stringify(entry));
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function locked(observer,pid) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const state=(await observer.query('select wait_event_type,wait_event,state from pg_stat_activity where pid=$1',[pid])).rows[0];
    if(state?.wait_event_type==='Lock') return state;
    await pause(20);
  }
  throw new Error(`Expected independent backend ${pid} to be waiting on a lock`);
}
const settle=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
let admin, a, b, blocker, started=false;
const migrationHashes={};
try {
  binary('initdb',['-D',temp,'-A','trust','-U','scm_fixture','--no-locale','-E','UTF8'],true);
  binary('pg_ctl',['-D',temp,'-o',`-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,'-l',join(temp,'postgres.log'),'-w','start'],true); started=true;
  [admin,a,b,blocker]=await Promise.all(['observer','a','b','blocker'].map(client));
  assert.equal(new Set([admin.pid,a.pid,b.pid,blocker.pid]).size,4);
  await admin.query(`create role anon;create role authenticated;create role service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for(const name of readdirSync(join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')&&Number(n.slice(0,3))<=46).sort()) {
    if(name.startsWith('046_')) {
      await admin.query('alter default privileges in schema public grant all on tables to service_role');
      await admin.query("insert into inbound_checkin_rows(id,terminal,site_code,site_name,sub_location,received_date,mark,shipper,bol_bc,draft_status,matched_order_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','HOU','5300','Houston 5300','MAIN','2026-10-13','LEGACY','FIXTURE',88,'failed','LEGACY_ORDER')");
    }
    const sql=readFileSync(join(root,'supabase/migrations',name),'utf8');
    migrationHashes[name]=createHash('sha256').update(sql).digest('hex');
    try {await admin.query(sql);}catch(error){throw new Error(`${name}: ${error.message}`);}
  }
  const staff=(await admin.query(`insert into scm_staff(email,name,role,status,user_id) values('fixture@example.test','Fixture','admin','active',gen_random_uuid()) returning *`)).rows[0];
  async function receipt(extra={}) {
    const v={terminal:'HOU',site_code:'5300',site_name:'Houston 5300',sub_location:'MAIN',received_date:'2026-10-13',
      mark:'TEST-'+randomUUID(),shipper:'FIXTURE',bol_bc:88,bale_count:88,warehouse_location:'A1',equipment_type:'V',
      checked_in_at:new Date().toISOString(),verified:true,verified_at:new Date().toISOString(),draft_status:'failed',
      yard_status:'working',material_type:'cotton',movement_direction:'delivery',reference_number:'60136',
      driver_name:'Fixture Driver',trucking_company:'Fixture Carrier',comment_1:'Retain damage note',bol_photo_path:'fixture/photo.jpg',
      mcleod_lookup_attempt_id:randomUUID(),mcleod_lookup_status:'unresolved',mcleod_lookup_failure_code:'SEARCH_LIMIT_REACHED',
      mcleod_lookup_failed_at:new Date().toISOString(),mcleod_processing_phase:'lookup',...extra};
    const names=Object.keys(v);return (await admin.query(`insert into inbound_checkin_rows(${names.join(',')}) values(${names.map((_,i)=>'$'+(i+1))}) returning *`,Object.values(v))).rows[0];
  }
  const finish=(c,row,key,reason='Staff confirms physical receiving completed')=>c.query(`select * from complete_inbound_outside_carrier($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,[row.id,row.terminal,row.site_code,row.updated_at,row.mcleod_lookup_attempt_id,key,staff.id,staff.user_id,reason]);
  await scenario('Full migration chain and four independent PostgreSQL sessions',async()=>{assert.ok(migrationHashes['046_staff_outside_carrier_checkout.sql']);});
  await scenario('Migration seeds legacy match evidence and prevents later detachment',async()=>{
    assert.equal(await scalar(admin,"select mcleod_lookup_has_known_match value from inbound_checkin_rows where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"),true);
    await assert.rejects(admin.query("update inbound_checkin_rows set matched_order_id=null where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"));
  });
  await scenario('Concurrent same-key overrides produce one completion and one immutable audit',async()=>{
    const row=await receipt(),key=randomUUID(); await blocker.query('begin');await blocker.query('select id from inbound_checkin_rows where id=$1 for update',[row.id]);
    const pa=settle(finish(a,row,key)),pb=settle(finish(b,row,key));await locked(admin,a.pid);await locked(admin,b.pid);await blocker.query('commit');
    const result=await Promise.all([pa,pb]);assert.ok(result.every(v=>v.ok),JSON.stringify(result));
    assert.equal(result[0].value.rows[0].yard_status,'completed');assert.equal(result[0].value.rows[0].mcleod_lookup_status,'unresolved');
    const event=(await admin.query('select * from inbound_outside_carrier_events where checkin_id=$1',[row.id])).rows;assert.equal(event.length,1);
    assert.equal(await scalar(admin,'select count(*)::int value from warehouse_inventory_lots where source_checkin_id=$1',[row.id]),1);
    assert.equal((await a.query('select * from claim_inbound_checkin_row_v2($1)',[row.id])).rows.length,0);
    for(const field of ['reference_number','driver_name','trucking_company','comment_1','bol_photo_path','checked_in_at'])assert.deepEqual(event[0].before_values[field],event[0].after_values[field]);
    await assert.rejects(finish(a,row,key,'A different reason'),/already been completed/);
    await assert.rejects(admin.query("update inbound_checkin_rows set yard_status='working' where id=$1",[row.id]),/reconciliation/);
  });
  await scenario('Competing distinct override keys cannot duplicate audit or effects',async()=>{
    const row=await receipt();const results=await Promise.all([settle(finish(a,row,randomUUID())),settle(finish(b,row,randomUUID()))]);assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal(await scalar(admin,'select count(*)::int value from inbound_outside_carrier_events where checkin_id=$1',[row.id]),1);
  });
  await scenario('Manual override racing an active processing claim cannot detach it',async()=>{
    const row=await receipt();await blocker.query('begin');await blocker.query("update inbound_checkin_rows set draft_status='ready' where id=$1",[row.id]);
    await blocker.query('select * from claim_inbound_checkin_row_v2($1)',[row.id]);const pending=settle(finish(a,row,randomUUID()));await locked(admin,a.pid);await blocker.query('commit');
    assert.equal((await pending).ok,false);assert.equal(await scalar(admin,'select count(*)::int value from inbound_outside_carrier_events where checkin_id=$1',[row.id]),0);
  });
  await scenario('Aborted completion transaction rolls back event and permits safe retry',async()=>{
    const row=await receipt(),key=randomUUID();await a.query('begin');await finish(a,row,key);await a.query('rollback');
    assert.equal(await scalar(admin,'select count(*)::int value from inbound_outside_carrier_events where checkin_id=$1',[row.id]),0);await finish(b,row,key);
  });
  await scenario('Known match, pending write, shortage, stale revision and wrong staff reject override',async()=>{
    for(const extra of [{matched_order_id:'KNOWN'},{matched_order_id:'KNOWN2',matched_stop_id:'STOP'},{mcleod_lookup_has_known_match:true},{mcleod_processing_phase:'write_pending'},{bale_count:80}]) {
      const row=await receipt(extra);await assert.rejects(finish(a,row,randomUUID()));
    }
    const row=await receipt();await assert.rejects(finish(a,{...row,updated_at:new Date(0)},randomUUID()));
    await admin.query("update scm_staff set role='viewer' where id=$1",[staff.id]);await assert.rejects(finish(a,row,randomUUID()),/staff access/);
    await admin.query("update scm_staff set role='operator',terminal='SAV' where id=$1",[staff.id]);await assert.rejects(finish(a,row,randomUUID()),/staff access/);
    await admin.query("update scm_staff set role='admin',terminal=null where id=$1",[staff.id]);
    const grants=(await admin.query("select has_table_privilege('authenticated','inbound_outside_carrier_events','select') r,has_table_privilege('service_role','inbound_outside_carrier_events','update') u,has_function_privilege('authenticated','complete_inbound_outside_carrier(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid,boolean,text)','execute') x")).rows[0];assert.deepEqual(grants,{r:false,u:false,x:false});
  });
  await scenario('Old application claims and successful completion remain compatible',async()=>{
    const row=await receipt({draft_status:'ready',mcleod_lookup_attempt_id:null,mcleod_lookup_status:null,mcleod_processing_phase:null,mcleod_lookup_failure_code:null,mcleod_lookup_failed_at:null});
    const claimed=(await a.query('select * from claim_inbound_checkin_row($1)',[row.id])).rows[0];assert.equal(claimed.mcleod_processing_phase,'legacy_processing');
    await a.query("update inbound_checkin_rows set draft_status='outside_carrier',processed_at=now(),processing_error=null where id=$1",[row.id]);
    await a.query("update inbound_checkin_rows set yard_status='completed',yard_completed_at=now() where id=$1",[row.id]);
    assert.equal(await scalar(admin,'select count(*)::int value from warehouse_inventory_lots where source_checkin_id=$1',[row.id]),1);
  });
  await scenario('Generic legacy failure cannot be laundered into a fresh lookup',async()=>{
    const row=await receipt({draft_status:'ready',mcleod_lookup_attempt_id:null,mcleod_lookup_status:null,mcleod_processing_phase:null});
    await a.query('select * from claim_inbound_checkin_row($1)',[row.id]);
    await a.query("update inbound_checkin_rows set draft_status='failed',processing_error='Network response lost' where id=$1",[row.id]);
    await a.query("update inbound_checkin_rows set draft_status='checked_in',processing_error=null where id=$1",[row.id]);
    assert.equal(await scalar(admin,'select mcleod_processing_phase value from inbound_checkin_rows where id=$1',[row.id]),'legacy_review');
    await assert.rejects(a.query("update inbound_checkin_rows set draft_status='ready',mcleod_processing_phase='lookup' where id=$1",[row.id]));
  });
  await scenario('Exact proven legacy cap permits only fresh lookup, with old-response fencing',async()=>{
    const row=await receipt({draft_status:'failed',mcleod_lookup_attempt_id:null,mcleod_lookup_status:null,mcleod_processing_phase:null,
      processing_error:'McLeod search incomplete (result limit reached); cannot classify outside carrier. Review McLeod search logs.'});
    await assert.rejects(finish(a,row,randomUUID()));
    await a.query("update inbound_checkin_rows set draft_status='ready',processing_error=null,mcleod_processing_phase='lookup' where id=$1",[row.id]);
    const fresh=(await a.query('select * from claim_inbound_checkin_row_v2($1)',[row.id])).rows[0];assert.ok(fresh.mcleod_lookup_attempt_id);
    await assert.rejects(a.query("update inbound_checkin_rows set draft_status='outside_carrier',processed_at=now() where id=$1",[row.id]),/versioned attempt/);
    const failed=(await a.query("update inbound_checkin_rows set draft_status='failed',mcleod_processing_result_id=$2,mcleod_lookup_status='unresolved',mcleod_lookup_failure_code='SEARCH_LIMIT_REACHED',mcleod_lookup_failed_at=now() where id=$1 returning *",[row.id,fresh.mcleod_lookup_attempt_id])).rows[0];
    await finish(a,failed,randomUUID());
  });
  await scenario('Read-only interrupted recovery fences stale workers and preserves known evidence',async()=>{
    for(const status of ['pending','searching','unresolved','conflict','error']) {
      const row=await receipt({draft_status:'processing',mcleod_lookup_status:status,mcleod_lookup_has_known_match:status==='conflict'});
      const fresh=(await a.query('select * from retry_inbound_checkin_lookup($1,$2,$3,$4,$5,$6)',[row.id,row.terminal,row.site_code,row.updated_at,staff.id,staff.user_id])).rows[0];
      assert.notEqual(fresh.mcleod_lookup_attempt_id,row.mcleod_lookup_attempt_id);
      assert.equal(fresh.mcleod_lookup_has_known_match,status==='conflict');
      const stale=await b.query("update inbound_checkin_rows set mcleod_processing_phase='matched' where id=$1 and mcleod_lookup_attempt_id=$2",[row.id,row.mcleod_lookup_attempt_id]);assert.equal(stale.rowCount,0);
    }
  });
  await scenario('Old claim and queue cancellation cannot bypass versioned write protections',async()=>{
    const row=await receipt({draft_status:'ready'});await assert.rejects(a.query('select * from claim_inbound_checkin_row($1)',[row.id]),/versioned/);
    const pending=await receipt({draft_status:'failed',mcleod_processing_phase:'write_pending'});
    await assert.rejects(a.query("update inbound_checkin_rows set draft_status='ready' where id=$1",[pending.id]));
    await assert.rejects(a.query("update inbound_checkin_rows set yard_status='cancelled' where id=$1",[pending.id]));
    await assert.rejects(a.query('select * from retry_inbound_checkin_lookup($1,$2,$3,$4,$5,$6)',[pending.id,pending.terminal,pending.site_code,pending.updated_at,staff.id,staff.user_id]));
  });
  for(const [name,hash] of Object.entries(migrationHashes))assert.equal(createHash('sha256').update(readFileSync(join(root,'supabase/migrations',name))).digest('hex'),hash,'Migrations changed during validation; rerun');
  console.log(JSON.stringify({passed:successes.length,engine:await scalar(admin,'select version() value'),migrationHashes,noExternalServices:true}));
} finally {
  for(const c of clients)await c.end().catch(()=>{});
  if(started)binary('pg_ctl',['-D',temp,'-m','immediate','-w','stop'],true);
}
