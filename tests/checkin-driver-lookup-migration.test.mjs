import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('044 then additive 045 preserves canonical references and legacy rows without guessing original driver input', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table inbound_checkin_rows(id serial primary key, matched_order_id text, reference_number text, terminal text, site_code text, movement_direction text);
      insert into inbound_checkin_rows(matched_order_id,reference_number,terminal,site_code,movement_direction) values ('OLD','CANONICAL','HOU','5300','pickup');`);
    for (const name of ['044_selected_checkin_stop.sql', '045_driver_lookup_input.sql']) await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select reference_number,driver_lookup_input,matched_stop_id from inbound_checkin_rows')).rows,
      [{ reference_number: 'CANONICAL', driver_lookup_input: null, matched_stop_id: null }]);
    await db.exec(`insert into inbound_checkin_rows(matched_order_id,matched_stop_id,reference_number,driver_lookup_input) values ('SCM-ABC','STOP','CANONICAL-REF','scm-abc')`);
    assert.equal((await db.query('select driver_lookup_input from inbound_checkin_rows where id=2')).rows[0].driver_lookup_input, 'scm-abc');
    for (const input of ['', 'AB', 'X'.repeat(121)]) await assert.rejects(db.query('insert into inbound_checkin_rows(driver_lookup_input) values ($1)', [input]));
  } finally { await db.close(); }
});
