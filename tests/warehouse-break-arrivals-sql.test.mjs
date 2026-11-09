import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261109200524_break_marks_and_daily_arrival_numbers.sql',import.meta.url),'utf8');
test('break inventory imports are atomic, idempotent, audited and available without source deductions; arrival numbers survive checkout',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table inbound_checkin_rows(id uuid primary key default gen_random_uuid(),terminal text not null,site_code text not null,material_type text,checked_in_at timestamptz,created_at timestamptz default now(),yard_status text);
 insert into inbound_checkin_rows(terminal,site_code,material_type,checked_in_at,yard_status) values
 ('HOU','5300','cotton','2026-11-09T08:00:00-06','completed'),('HOU','5300','lumber','2026-11-09T09:00:00-06','waiting');`);
 const foundation=readFileSync(new URL('../supabase/migrations/021_warehouse_inventory.sql',import.meta.url),'utf8').split('create or replace function public.set_updated_at_warehouse_inventory_lot')[0];
 await db.exec(foundation.replace("terminal in ('SAV', 'HOU')","terminal in ('SAV', 'HOU', 'DAL')"));
 await db.exec(migration);
 const call=async(request,rows,terminal='HOU',site='5300')=>(await db.query('select import_warehouse_break_marks($1,$2,$3,$4,$5,$6,$7::jsonb,$8) result',[request,terminal,site,'Fixture warehouse','CUSTOMER','A1',JSON.stringify(rows),'operator@example.com'])).rows[0].result;
 const rows=[{mark:'RZ024',shippingOrder:'52918',bales:90},{mark:'RZ023',shippingOrder:'52917',bales:91}];
 await db.exec("insert into warehouse_inventory_lots(terminal,site_code,site_name,mark,customer,original_bales,current_bales) values('HOU','5300','Fixture','SOURCE','CUSTOMER',200,200)");
 const request=randomUUID(),result=await call(request,rows);
 assert.equal(result.created,2);assert.equal(result.existing,0);
 assert.deepEqual(await call(request,rows),result);
 assert.equal((await call(randomUUID(),rows)).existing,2);
 const lots=(await db.query("select * from warehouse_inventory_lots where source_type='break' order by mark")).rows;
 assert.equal(lots.length,2);assert.equal(lots[1].current_bales-lots[1].allocated_bales,90);
 assert.equal(lots[1].ecotton_receipt_status,'not_required');assert.equal(lots[1].shipping_order,'52918');
 assert.match(lots[1].notes,/reconciliation pending/);
 assert.equal((await db.query("select current_bales from warehouse_inventory_lots where mark='SOURCE'")).rows[0].current_bales,200);
 assert.equal((await db.query('select count(*)::int n from warehouse_inventory_events')).rows[0].n,2);
 await assert.rejects(call(randomUUID(),[{mark:'NEW',shippingOrder:'12',bales:90},{...rows[0],bales:89}]),/different quantity/);
 assert.equal((await db.query("select count(*)::int n from warehouse_inventory_lots where mark='NEW'")).rows[0].n,0);
 await assert.rejects(call(request,[rows[0]]),/different data/);
 assert.equal((await call(randomUUID(),[rows[0]],'DAL','SCMDDETX')).created,1);
 const before=(await db.query("select n.*,r.yard_status from warehouse_arrival_numbers n join inbound_checkin_rows r on r.id=n.checkin_id order by queue_number")).rows;
 assert.deepEqual(before.map(r=>r.queue_number),[1,2]);
 await db.exec("update inbound_checkin_rows set yard_status='completed' where yard_status='waiting'");
 const insert=async(site='5300',time='2026-11-09T10:00:00-06')=>(await db.query("insert into inbound_checkin_rows(terminal,site_code,material_type,checked_in_at,yard_status) values('HOU',$1,'other',$2,'waiting') returning id",[site,time])).rows[0].id;
 const third=await insert();
 assert.equal((await db.query('select queue_number from warehouse_arrival_numbers where checkin_id=$1',[third])).rows[0].queue_number,3);
 await db.query('delete from inbound_checkin_rows where id=$1',[third]);
 const fourth=await insert();
 assert.equal((await db.query('select queue_number from warehouse_arrival_numbers where checkin_id=$1',[fourth])).rows[0].queue_number,4);
 for(const id of [await insert('4331'),await insert('5300','2026-11-10T00:01:00-06')]) assert.equal((await db.query('select queue_number from warehouse_arrival_numbers where checkin_id=$1',[id])).rows[0].queue_number,1);
 await db.exec("set role authenticated");
 await assert.rejects(db.query('select * from warehouse_arrival_numbers'),/permission denied/);
 await assert.rejects(call(randomUUID(),rows),/permission denied/);
 } finally {await db.close();}
});
