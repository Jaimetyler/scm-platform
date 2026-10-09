import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('selected-stop migration works independently, preserves legacy nulls and clears stale bindings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table inbound_checkin_rows(id serial primary key, matched_order_id text, terminal text,
        site_code text, movement_direction text, comment_1 text);
      insert into inbound_checkin_rows(matched_order_id,terminal,site_code,movement_direction)
        values ('ORDER','HOU','5300','delivery');`);
    await db.exec(readFileSync(new URL('../supabase/migrations/044_selected_checkin_stop.sql', import.meta.url), 'utf8'));
    const saved = async () => (await db.query('select matched_stop_id from inbound_checkin_rows where id=1')).rows[0].matched_stop_id;
    assert.equal(await saved(), null);
    await db.exec(`update inbound_checkin_rows set matched_stop_id='STOP'; update inbound_checkin_rows set comment_1='note';`);
    assert.equal(await saved(), 'STOP');
    for (const change of ["matched_order_id='OTHER'", "terminal='SAV'", "site_code='1601'", "movement_direction='pickup'"]) {
      await db.exec(`update inbound_checkin_rows set matched_stop_id='STOP'; update inbound_checkin_rows set ${change};`);
      assert.equal(await saved(), null);
    }
    await db.exec(`update inbound_checkin_rows set matched_stop_id='STOP';
      update inbound_checkin_rows set matched_order_id='NEW', matched_stop_id='NEW-STOP';`);
    assert.equal(await saved(), 'NEW-STOP');
    await db.exec(`update inbound_checkin_rows set matched_order_id=null;`);
    assert.equal(await saved(), null);
    await assert.rejects(db.exec(`insert into inbound_checkin_rows(matched_stop_id) values ('ORPHAN')`));
    await assert.rejects(db.exec(`update inbound_checkin_rows set matched_order_id='ORDER', matched_stop_id=''`));
    const privileges = (await db.query(`select has_function_privilege('anon','clear_stale_checkin_stop()','EXECUTE') anon,
      has_function_privilege('authenticated','clear_stale_checkin_stop()','EXECUTE') authenticated,
      has_function_privilege('service_role','clear_stale_checkin_stop()','EXECUTE') service`)).rows[0];
    assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
  } finally { await db.close(); }
});
