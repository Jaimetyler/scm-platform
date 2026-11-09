import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
test('warehouse global search covers stock, break marks, SOs, bookings, equipment and arrival history while isolating sites',async()=>{
 const db=new PGlite();try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table warehouse_inventory_lots(id uuid default gen_random_uuid(),terminal text,site_code text,site_name text,mark text,customer text,shipping_order text,booking_number text,warehouse_location text,inventory_status text,current_bales int,source_type text,received_date date);
 create table cotton_outbound_bookings(id uuid default gen_random_uuid(),terminal text,site_code text,site_name text,booking_number text,customer text,scm_file_number text,customer_reference text,status text,requested_bales int,source_format text,cutoff date,updated_at timestamptz default now());
 create table cotton_outbound_booking_lines(booking_id uuid,mark text,shipping_order text,source_row int);
 create table cotton_outbound_containers(booking_id uuid,container_number text,seal_number text,chassis_number text,sequence_no int);
 create table inbound_checkin_rows(id uuid default gen_random_uuid(),terminal text,site_code text,site_name text,mark text,reference_number text,driver_name text,shipper text,trucking_company text,matched_order_id text,trailer_number text,movement_direction text,yard_status text,draft_status text,bale_count int,material_type text,checked_in_at timestamptz);
 create table container_gate_queue(id uuid default gen_random_uuid(),terminal text,site_code text,site_name text,driver_name text,queue_status text,checked_in_at timestamptz);
 insert into warehouse_inventory_lots(terminal,site_code,mark,customer,shipping_order,source_type,current_bales,inventory_status) values('HOU','5300','E1078','BUNGE','53001','break',90,'active'),('HOU','4331','E1078','BUNGE','53001','checkin',90,'active'),('SAV','175','E1078','BUNGE','53001','checkin',90,'closed');
 insert into cotton_outbound_bookings(terminal,site_code,booking_number,customer,status,scm_file_number) values('HOU','5300','BOOK123','BUNGE','draft','001234');
 insert into cotton_outbound_booking_lines select id,'E1078','53001',1 from cotton_outbound_bookings;
 insert into cotton_outbound_containers select id,'ABCD1234567','SEAL88','SCMI1234',1 from cotton_outbound_bookings;
 insert into inbound_checkin_rows(terminal,site_code,mark,driver_name,trucking_company,matched_order_id,trailer_number,yard_status,checked_in_at) values('HOU','5300','E1078','Test Driver','Test Carrier','SCM9988','TRL555','completed','2020-01-01T12:00Z');
 insert into container_gate_queue(terminal,site_code,driver_name,queue_status,checked_in_at) values('HOU','5300','Container Driver','completed',now());`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261109203107_warehouse_global_search.sql',import.meta.url),'utf8'));
 const search=async(q,terminal='HOU',site='5300')=>(await db.query('select search_warehouse_operations($1,$2,$3) r',[q,terminal,site])).rows[0].r;
 let r=await search('e1078');assert.equal(r.inventory.length,1);assert.equal(r.inventory[0].kind,'break');assert.equal(r.bookings.length,1);assert.equal(r.checkins[0].status,'completed');
 assert.equal((await search('53001')).inventory.length,1);assert.equal((await search('53001')).bookings.length,1);
 for(const q of ['ABCD1234567','SEAL88','SCMI1234','001234','BOOK123'])assert.equal((await search(q)).bookings.length,1,q);
 for(const q of ['Test Driver','Test Carrier','SCM9988','TRL555'])assert.equal((await search(q)).checkins.length,1,q);
 assert.equal((await search('Container Driver')).containerArrivals.length,1);
 assert.equal((await search('E1078','HOU',null)).inventory.length,2);assert.equal((await search('E1078',null,null)).inventory.length,3);
 assert.equal((await search('%_')).inventory.length,0);await assert.rejects(search('a'),/2-100/);
 for(let i=0;i<30;i++)await db.query("insert into warehouse_inventory_lots(terminal,site_code,mark) values('HOU','5300',$1)",['MANY'+i]);
 assert.equal((await search('MANY')).inventory.length,26);
 await db.exec('set role authenticated');await assert.rejects(search('E1078'),/permission denied/);
 }finally{await db.close();}
});
