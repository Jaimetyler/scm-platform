import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = (number) => readFile(new URL(`../supabase/migrations/${number}`, import.meta.url), "utf8");
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table warehouse_inventory_lots (mark text, terminal text, site_code text, inventory_status text, current_bales integer, allocated_bales integer);`);
  for (const name of ["030_cotton_outbound_booking_drafts.sql", "031_cotton_outbound_containers.sql", "032_cotton_outbound_mark_planning.sql", "033_outbound_automatic_mark_assignment.sql", "034_cotton_outbound_bulk_rollover.sql"])
    await db.exec(await migration(name));
  return db;
}
async function seed(db) {
  const lines = ["MARK-A", "MARK-B", "MARK-C"].map((mark, index) => ({ mark, sourceRow: index + 1, bales: 90, loadBy: "2026-10-01", confirmed: false, warehouse: "Savannah 984" }));
  const { rows } = await db.query(`select create_cotton_outbound_booking_draft('SAV','984','Savannah 984','Bunge','SOURCE-001','',3,270,'test.xlsx',$1::jsonb) as id`, [JSON.stringify(lines)]);
  const id = rows[0].id;
  return { id, lines: (await db.query("select * from cotton_outbound_booking_lines where booking_id=$1 order by mark", [id])).rows };
}
const apply = async (db) => db.exec(await migration("035_outbound_booking_details_and_split_history.sql"));

test("migration restores yesterday's moved rows and locks them on repeat application", async () => {
  const db = await database();
  try {
    const { id, lines } = await seed(db);
    await db.query("select roll_cotton_outbound_booking_line($1,90,'TARGET-001')", [lines[0].id]);
    await apply(db);
    const rows = (await db.query(`select c.*, t.mark, b.booking_number from cotton_outbound_containers c
      join cotton_outbound_booking_transfers t on t.id=c.split_transfer_id
      join cotton_outbound_bookings b on b.id=t.target_booking_id where c.booking_id=$1`, [id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mark, "MARK-A");
    assert.equal(rows[0].booking_number, "TARGET-001");
    assert.equal(rows[0].booking_line_id, null);
    await assert.rejects(db.query("update cotton_outbound_containers set notes='edit' where id=$1", [rows[0].id]), /locked/);
    await assert.rejects(db.query("update cotton_outbound_containers set split_transfer_id=null where id=$1", [rows[0].id]), /locked/);
    await apply(db);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_containers where booking_id=$1 and split_transfer_id is not null", [id])).rows[0].n, 1);
  } finally { await db.close(); }
});

test("bulk full/partial splits conserve bales, keep partial rows, and never reuse locked slots", async () => {
  const db = await database();
  try {
    await apply(db);
    const { id, lines } = await seed(db);
    const originalPartialSlot = (await db.query("select id from cotton_outbound_containers where booking_line_id=$1", [lines[1].id])).rows[0].id;
    const moves = [{ lineId: lines[0].id, bales: 90 }, { lineId: lines[1].id, bales: 30 }];
    const target = (await db.query("select bulk_roll_cotton_outbound_booking_lines($1,$2::jsonb,'TARGET-002') as id", [id, JSON.stringify(moves)])).rows[0].id;
    const partial = (await db.query("select c.id,l.requested_bales from cotton_outbound_containers c join cotton_outbound_booking_lines l on l.id=c.booking_line_id where l.id=$1", [lines[1].id])).rows[0];
    assert.equal(partial.id, originalPartialSlot);
    assert.equal(partial.requested_bales, 60);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_containers where booking_id=$1 and split_transfer_id is not null", [id])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_containers where booking_id=$1 and booking_line_id is not null", [target])).rows[0].n, 2);
    assert.equal((await db.query("select sum(requested_bales)::int as n from cotton_outbound_bookings")).rows[0].n, 270);
    await db.query("select roll_cotton_outbound_booking_line($1,30,'SOURCE-001')", [(await db.query("select id from cotton_outbound_booking_lines where booking_id=$1 and mark='MARK-B'", [target])).rows[0].id]);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_containers where booking_id=$1 and split_transfer_id is not null", [id])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_containers where booking_id=$1 and booking_line_id is not null", [id])).rows[0].n, 3);
    // A stale details edit must not overwrite a later booking edit.
    const stamp = (await db.query("select updated_at from cotton_outbound_bookings where id=$1", [id])).rows[0].updated_at;
    await db.query("update cotton_outbound_bookings set vessel='MSC TEST',erd='2026-10-01',doc_cutoff='2026-10-03 16:00',cutoff='2026-10-04 17:30' where id=$1", [id]);
    assert.equal((await db.query("update cotton_outbound_bookings set vessel='STALE' where id=$1 and updated_at=$2 returning id", [id, stamp])).rows.length, 0);
    assert.equal((await db.query("select to_char(doc_cutoff,'YYYY-MM-DD HH24:MI') as cutoff from cotton_outbound_bookings where id=$1", [id])).rows[0].cutoff, "2026-10-03 16:00");
    // A later invalid move must roll back the full batch.
    const before = (await db.query("select requested_bales from cotton_outbound_bookings where id=$1", [id])).rows[0].requested_bales;
    await db.query("update cotton_outbound_containers set notes='equipment entered' where booking_line_id=$1", [lines[2].id]);
    await assert.rejects(db.query("select bulk_roll_cotton_outbound_booking_lines($1,$2::jsonb,'INVALID-001')", [id, JSON.stringify([{ lineId: lines[1].id, bales: 10 }, { lineId: lines[2].id, bales: 10 }])]), /Clear the equipment/);
    assert.equal((await db.query("select requested_bales from cotton_outbound_bookings where id=$1", [id])).rows[0].requested_bales, before);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_bookings where booking_number='INVALID-001'")).rows[0].n, 0);
  } finally { await db.close(); }
});
