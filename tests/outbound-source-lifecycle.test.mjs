import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import XLSX from 'xlsx';
import { containerInfoWorkbook } from '../lib/warehouse/outbound/container-info.ts';
import { bookingMarkBadges } from '../lib/warehouse/outbound/marks.ts';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table warehouse_inventory_lots(mark text,terminal text,site_code text,inventory_status text,current_bales integer,allocated_bales integer);
    create table inbound_checkin_rows(id uuid primary key default gen_random_uuid(), mark text,material_type text,movement_direction text,
      terminal text,site_code text,site_name text,checked_in_at timestamptz,yard_status text);`);
  for (const name of ['030_cotton_outbound_booking_drafts.sql','031_cotton_outbound_containers.sql','032_cotton_outbound_mark_planning.sql',
    '033_outbound_automatic_mark_assignment.sql','034_cotton_outbound_bulk_rollover.sql','035_outbound_booking_details_and_split_history.sql',
    '036_outbound_import_sailing_details.sql','038_outbound_add_booking_marks.sql','039_outbound_mark_lifecycle_and_source_loads.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  return db;
}
async function seed(db, number='TEST-001') {
  const lines = [{ sourceRow:1,mark:'STOCK',bales:90,loadBy:null,confirmed:false,warehouse:'Savannah 984',loadSource:'warehouse' },
    { sourceRow:2,mark:'SOURCE',bales:90,loadBy:null,confirmed:false,warehouse:'Outside gin',loadSource:'source_load' },
    { sourceRow:3,mark:'MISSING',bales:90,loadBy:'1999-01-01',confirmed:false,warehouse:'Savannah 984',loadSource:'warehouse' }];
  const id=(await db.query(`select create_cotton_outbound_booking_draft_with_details('SAV','984','Savannah 984','BUNGE',$1,'',3,270,'request.xlsx',$2::jsonb,$3::jsonb) id`,
    [number,JSON.stringify(lines),JSON.stringify({erd:'2026-10-01',cutoff:'2026-10-05T12:00',doc_cutoff:'2026-10-04',cutoff_has_time:true})])).rows[0].id;
  return {id,lines:(await db.query('select * from cotton_outbound_booking_lines where booking_id=$1 order by source_row',[id])).rows};
}
async function change(db,booking,line,action,note='',at=null,site='984') {
  const current=at??(await db.query('select updated_at from cotton_outbound_bookings where id=$1',[booking])).rows[0].updated_at;
  return db.query(`select change_cotton_outbound_mark($1,$2,'SAV',$3,$4,$5,$6,'Jaime')`,[booking,line,site,current,action,note]);
}
async function arrival(db,mark,values={}) {
  return (await db.query(`insert into inbound_checkin_rows(mark,material_type,movement_direction,terminal,site_code,site_name,checked_in_at,yard_status)
    values($1,$2,$3,'HOU','900','Houston 900',now(),'waiting') returning id`,[mark,values.material??'cotton',values.direction??'delivery'])).rows[0].id;
}

test('imports keep source classification, nullable legacy dates, and editable sailing details; dashboard counts distinct incomplete warehouse marks',async()=>{
  const db=await database();try {
    const {id,lines}=await seed(db);
    assert.equal(lines[1].load_source,'source_load');assert.equal(lines[0].load_by,null);
    await db.query(`insert into warehouse_inventory_lots values('STOCK','SAV','984','on_hold',87,87)`);
    let metrics=(await db.query('select * from cotton_outbound_booking_dashboard where id=$1',[id])).rows[0];
    assert.equal(metrics.missing_marks,2);assert.equal(metrics.source_loads,1);assert.equal(metrics.erd.toISOString().slice(0,10),'2026-10-01');
    await db.query(`insert into warehouse_inventory_lots values('STOCK','SAV','984','active',3,3)`);
    assert.equal((await db.query('select missing_marks from cotton_outbound_booking_dashboard where id=$1',[id])).rows[0].missing_marks,1);
    await change(db,id,lines[2].id,'hold','Waiting for customer');
    metrics=(await db.query('select * from cotton_outbound_booking_dashboard where id=$1',[id])).rows[0];
    assert.equal(metrics.missing_marks,0);assert.equal(metrics.held_marks,1);assert.equal(metrics.requested_bales,270);
  }finally{await db.close();}
});

test('hold locks equipment and both split endpoints; resume restores editing; cancel removes even final mark while retaining equipment and audit',async()=>{
  const db=await database();try {
    const {id,lines}=await seed(db);const line=lines[0];
    await db.query(`update cotton_outbound_containers set container_number='ABCD1234567',seal_number='SEAL' where booking_line_id=$1`,[line.id]);
    const at=(await db.query('select updated_at from cotton_outbound_bookings where id=$1',[id])).rows[0].updated_at;
    await change(db,id,line.id,'hold','No instructions');
    await assert.rejects(change(db,id,line.id,'cancel','',at),/changed/);
    await assert.rejects(db.query(`update cotton_outbound_containers set container_number='OTHER' where booking_line_id=$1`,[line.id]),/locked/);
    await assert.rejects(db.query(`select roll_cotton_outbound_booking_line($1,1,'TEST-002')`,[line.id]),/Resume held/);
    await assert.rejects(db.query(`select bulk_roll_cotton_outbound_booking_lines($1,$2::jsonb,'TEST-002')`,[id,JSON.stringify([{lineId:line.id,bales:1}])]),/equipment|Resume held/);
    await change(db,id,line.id,'resume');
    await db.query(`update cotton_outbound_containers set seal_number='NEWSEAL' where booking_line_id=$1`,[line.id]);
    for (const item of lines) await change(db,id,item.id,'cancel','Cancelled by customer');
    assert.equal((await db.query('select requested_bales from cotton_outbound_bookings where id=$1',[id])).rows[0].requested_bales,0);
    assert.equal((await db.query('select seal_number from cotton_outbound_containers where booking_line_id=$1',[line.id])).rows[0].seal_number,'NEWSEAL');
    assert.equal((await db.query('select count(*)::int n from cotton_outbound_mark_events where booking_id=$1',[id])).rows[0].n,5);
    await assert.rejects(change(db,id,line.id,'resume'),/cancelled/);
    assert.equal((await db.query('select count(*)::int n from warehouse_inventory_lots')).rows[0].n,0);
  }finally{await db.close();}
});

test('exact source arrivals persist, avoid duplicates and pickup/unrelated marks; manual conversion resolves alerts without inventory receipt',async()=>{
  const db=await database();try {
    const {id,lines}=await seed(db);const source=lines[1];
    await arrival(db,'SOURCE-OTHER');await arrival(db,'SOURCE',{direction:'pickup'});await arrival(db,'SOURCE',{material:'lumber'});
    assert.equal((await db.query('select count(*)::int n from cotton_outbound_source_arrivals')).rows[0].n,0);
    const checkin=await arrival(db,' source ');
    await db.query(`update inbound_checkin_rows set yard_status='called' where id=$1`,[checkin]);
    assert.equal((await db.query('select source_arrivals from cotton_outbound_booking_dashboard where id=$1',[id])).rows[0].source_arrivals,1);
    await db.query(`update inbound_checkin_rows set yard_status='completed' where id=$1`,[checkin]);
    assert.equal((await db.query('select count(*)::int n from cotton_outbound_source_arrivals where resolved_at is null')).rows[0].n,1);
    await assert.rejects(change(db,id,source.id,'keep_source'),/note/);
    await change(db,id,source.id,'warehouse','Plan changed to warehouse unloading');
    assert.equal((await db.query('select load_source from cotton_outbound_booking_lines where id=$1',[source.id])).rows[0].load_source,'warehouse');
    assert.equal((await db.query('select source_arrivals,source_loads,missing_marks from cotton_outbound_booking_dashboard where id=$1',[id])).rows[0].source_arrivals,0);
    assert.equal((await db.query('select count(*)::int n from warehouse_inventory_lots')).rows[0].n,0);
    await arrival(db,'SOURCE');
    assert.equal((await db.query('select count(*)::int n from cotton_outbound_source_arrivals')).rows[0].n,1);
  }finally{await db.close();}
});

test('source imports detect trucks already in line; partial/full splits retain source planning and locked history',async()=>{
  const db=await database();try {
    await arrival(db,'SOURCE');const {id,lines}=await seed(db);
    assert.equal((await db.query('select source_arrivals from cotton_outbound_booking_dashboard where id=$1',[id])).rows[0].source_arrivals,1);
    const target=(await db.query(`select roll_cotton_outbound_booking_line($1,30,'TEST-002') id`,[lines[1].id])).rows[0].id;
    assert.equal((await db.query('select load_source from cotton_outbound_booking_lines where booking_id=$1',[target])).rows[0].load_source,'source_load');
    await db.query(`select roll_cotton_outbound_booking_line($1,60,'TEST-002')`,[lines[1].id]);
    assert.equal((await db.query('select count(*)::int n from cotton_outbound_booking_lines where booking_id=$1 and load_source=$2',[target,'source_load'])).rows[0].n,2);
    assert.equal((await db.query('select count(*)::int n from cotton_outbound_containers where booking_id=$1 and split_transfer_id is not null',[id])).rows[0].n,1);
    const targetSource=(await db.query('select id from cotton_outbound_booking_lines where booking_id=$1 limit 1',[target])).rows[0].id;
    await assert.rejects(change(db,id,targetSource,'cancel'),/not found/);
    await assert.rejects(change(db,id,lines[0].id,'hold','',null,'175'),/not found/);
  }finally{await db.close();}
});

test('container-info Excel has a booking header and only mark/container/seal columns, omitting held/cancelled/split rows',()=>{
  const booking={booking_number:'TEST-123',customer:'Bunge',site_name:'Savannah 984',erd:'2026-10-01',cutoff:'2026-10-05T00:00',cutoff_has_time:false};
  const lines=[{id:'source',mark:'SOURCE',line_status:'active',load_source:'source_load',source_row:1},
    {id:'warehouse',mark:'WAREHOUSE',line_status:'active',load_source:'warehouse',source_row:2},
    {id:'hold',mark:'HOLD',line_status:'on_hold',load_source:'warehouse',source_row:3},
    {id:'cancelled',mark:'CANCEL',line_status:'cancelled',load_source:'warehouse',source_row:4}];
  const containers=[{booking_line_id:'warehouse',container_number:'ABCD1234567',seal_number:'SEAL1',split_transfer_id:null,sequence_no:1},
    {booking_line_id:'source',container_number:'WXYZ1234567',seal_number:'SEAL2',split_transfer_id:null,sequence_no:2},
    {booking_line_id:null,container_number:null,seal_number:null,split_transfer_id:'split',sequence_no:3}];
  const workbook=XLSX.read(containerInfoWorkbook(booking,lines,containers),{type:'buffer'});
  const rows=XLSX.utils.sheet_to_json(workbook.Sheets['Container Info'],{header:1,defval:''});
  assert.deepEqual(rows[1],['Customer','Bunge','']);assert.deepEqual(rows[2],['Booking','TEST-123','']);
  assert.deepEqual(rows[10],['Mark','Container number','Seal number']);
  assert.deepEqual(rows.slice(11),[['WAREHOUSE','ABCD1234567','SEAL1'],['SOURCE','WXYZ1234567','SEAL2']]);
  assert.equal(rows[8][1],'2026-10-05');
  assert.deepEqual(bookingMarkBadges({available_bales:0,inbound_bales:0,line_status:'on_hold',load_source:'source_load'}).map((badge)=>badge.label),['On hold','Source load']);
});
