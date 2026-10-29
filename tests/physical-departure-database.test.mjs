import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');

test('physical departure and local-only migrations preserve intent, audit once, and restrict audit writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      alter default privileges in schema public grant all on tables to service_role;
      create table inbound_checkin_rows(id uuid primary key default gen_random_uuid(),
        checked_in_at timestamptz, yard_updated_by text, yard_status text, draft_status text,
        mcleod_processing_phase text, matched_order_id text, comment_1 text);
      insert into inbound_checkin_rows(comment_1) values ('local receiving only, reconcile before any McLeod update.'),('lookup failed');`);
    await db.exec(migration('049_physical_departure.sql'));
    await db.exec(migration('050_local_receiving_only.sql'));
    assert.deepEqual((await db.query('select local_receiving_only from inbound_checkin_rows order by comment_1')).rows.map(r => r.local_receiving_only), [true, false]);
    // Reproduce Supabase defaults: SELECT/INSERT grants alone do not remove ALL.
    assert.equal((await db.query("select has_table_privilege('service_role','inbound_physical_departure_events','DELETE') allowed")).rows[0].allowed, true);
    await db.exec(migration('20261027025917_physical_departure_audit_permissions.sql'));
    for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal((await db.query(`select has_table_privilege('service_role','inbound_physical_departure_events','${privilege}') allowed`)).rows[0].allowed, false);
    }
    for (const role of ['anon','authenticated']) assert.equal((await db.query(`select has_table_privilege('${role}','inbound_physical_departure_events','SELECT') allowed`)).rows[0].allowed, false);
    const row = (await db.query(`insert into inbound_checkin_rows(checked_in_at,yard_status,draft_status,yard_updated_by)
      values(clock_timestamp()-interval '1 hour','working','checked_in','test staff') returning id`)).rows[0];
    await db.query(`update inbound_checkin_rows set physical_departed_at=clock_timestamp(),yard_status='completed' where id=$1`,[row.id]);
    await db.query(`update inbound_checkin_rows set physical_departed_at=physical_departed_at where id=$1`,[row.id]);
    const audit = (await db.query('select * from inbound_physical_departure_events where checkin_id=$1',[row.id])).rows;
    assert.equal(audit.length,1); assert.equal(audit[0].actor,'test staff'); assert.equal(audit[0].previous_yard_status,'working');
    await assert.rejects(db.query(`update inbound_checkin_rows set physical_departed_at=null where id=$1`,[row.id]), /immutable/);
    await assert.rejects(db.query(`update inbound_checkin_rows set physical_departed_at=clock_timestamp()+interval '1 minute' where id=$1`,[row.id]), /immutable/);
    await db.exec('set role service_role');
    await assert.rejects(db.query('delete from inbound_physical_departure_events'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
