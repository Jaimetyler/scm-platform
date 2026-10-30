import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { normalizeBookingMark, bookingMarkBadges } from "../lib/warehouse/outbound/marks.ts";

const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table warehouse_inventory_lots(mark text,terminal text,site_code text,inventory_status text,current_bales integer,allocated_bales integer);`);
  for (const name of ["030_cotton_outbound_booking_drafts.sql", "031_cotton_outbound_containers.sql", "032_cotton_outbound_mark_planning.sql",
    "033_outbound_automatic_mark_assignment.sql", "034_cotton_outbound_bulk_rollover.sql", "035_outbound_booking_details_and_split_history.sql", "036_outbound_import_sailing_details.sql", "038_outbound_add_booking_marks.sql"])
    await db.exec(await migration(name));
  return db;
}
async function seed(db) {
  const lines = [{ sourceRow: 1, mark: "MARK-A", bales: 90, loadBy: "2026-10-03", confirmed: false, warehouse: "Savannah 984" }];
  return (await db.query(`select create_cotton_outbound_booking_draft('SAV','984','Savannah 984','BUNGE','TEST-001','',2,90,'request.xlsx',$1::jsonb) as id`, [JSON.stringify(lines)])).rows[0].id;
}
const updatedAt = async (db,id) => (await db.query("select updated_at from cotton_outbound_bookings where id=$1", [id])).rows[0].updated_at;
const add = async (db,id,at,requestId,mark="MARK-B",bales=87,site="984") => db.query(
  "select add_cotton_outbound_booking_mark($1,'SAV',$2,$3,$4,$5,$6,'SO-123','Jaime') as id", [id,site,at,requestId,mark,bales]);

test("mark badges distinguish check-in, warehouse receipt, combined arrivals, and not received", () => {
  const line = { available_bales: 0, warehouse_bales: 0, inbound_bales: 90, inbound_statuses: ["waiting"] };
  assert.deepEqual(bookingMarkBadges(line).map((b) => b.label), ["Checked in"]);
  assert.deepEqual(bookingMarkBadges({ ...line, warehouse_bales: 87, inbound_bales: 0, inbound_statuses: [] }).map((b) => b.label), ["In warehouse"]);
  assert.deepEqual(bookingMarkBadges({ ...line, warehouse_bales: 87 }).map((b) => b.label), ["In warehouse", "Checked in"]);
  assert.deepEqual(bookingMarkBadges({ ...line, inbound_bales: 0, inbound_statuses: [] }).map((b) => b.label), ["Not received"]);
  assert.deepEqual(normalizeBookingMark({ mark: " d0178 ", bales: "87", shippingOrder: " SO-123 " }), { mark: "D0178", bales: 87, shippingOrder: "SO-123" });
  for (const body of [{ mark: "", bales: 90 }, { mark: "A", bales: 0 }, { mark: "A", bales: 1.5 }, { mark: "<script>", bales: 90 }]) assert.throws(() => normalizeBookingMark(body));
});

test("adding a mark reuses an empty slot, updates totals once, and preserves equipment and inventory", async () => {
  const db = await database();
  try {
    const id = await seed(db);
    await db.query("insert into warehouse_inventory_lots values('MARK-A','SAV','984','active',90,0)");
    await db.query("update cotton_outbound_containers set container_number='ABCD1234567',seal_number='SEAL' where booking_id=$1 and booking_line_id is not null", [id]);
    const at = await updatedAt(db,id); const requestId=randomUUID();
    const lineId=(await add(db,id,at,requestId)).rows[0].id;
    assert.equal((await db.query("select requested_bales from cotton_outbound_bookings where id=$1", [id])).rows[0].requested_bales,177);
    assert.equal((await add(db,id,at,requestId)).rows[0].id,lineId);
    assert.equal((await db.query("select count(*)::int as n from cotton_outbound_booking_lines where booking_id=$1", [id])).rows[0].n,2);
    const rows=(await db.query("select * from cotton_outbound_containers where booking_id=$1 order by sequence_no", [id])).rows;
    assert.equal(rows.length,2); assert.equal(rows[0].container_number,'ABCD1234567'); assert.equal(rows[1].booking_line_id,lineId);
    const line=(await db.query("select * from cotton_outbound_booking_lines where id=$1", [lineId])).rows[0];
    assert.equal(line.shipping_order,'SO-123'); assert.equal(line.added_by,'Jaime');
    assert.equal((await db.query("select current_bales from warehouse_inventory_lots")).rows[0].current_bales,90);
    await assert.rejects(add(db,id,await updatedAt(db,id),randomUUID(),"mark-b"),/already on/);
    await assert.rejects(add(db,id,at,randomUUID(),"MARK-C"),/changed/);
    await assert.rejects(add(db,id,await updatedAt(db,id),randomUUID(),"MARK-C",90,"175"),/not found/);
  } finally { await db.close(); }
});

test("full slots cause one new assigned row, while locked split history stays unchanged", async () => {
  const db = await database();
  try {
    const id=await seed(db);
    const lines=JSON.stringify([{sourceRow:1,mark:'MARK-B',bales:90,loadBy:'2026-10-03',confirmed:false,warehouse:'Savannah 984'}, {sourceRow:2,mark:'MARK-Z',bales:90,loadBy:'2026-10-03',confirmed:false,warehouse:'Savannah 984'}]);
    const second=(await db.query(`select create_cotton_outbound_booking_draft('SAV','984','Savannah 984','BUNGE','TEST-002','',2,180,'request.xlsx',$1::jsonb) as id`,[lines])).rows[0].id;
    const sourceLine=(await db.query("select id from cotton_outbound_booking_lines where booking_id=$1 and mark='MARK-B'",[second])).rows[0].id;
    await db.query("select roll_cotton_outbound_booking_line($1,90,'TEST-001')",[sourceLine]);
    const before=(await db.query("select * from cotton_outbound_containers where booking_id=$1 and split_transfer_id is not null",[second])).rows;
    assert.equal(before.length,1);
    // Use the destination with all slots now occupied by A and B.
    const lineId=(await add(db,id,await updatedAt(db,id),randomUUID(),"MARK-C",90)).rows[0].id;
    const row=(await db.query("select * from cotton_outbound_containers where booking_line_id=$1",[lineId])).rows[0];
    assert.equal(row.sequence_no,3); assert.equal(row.split_transfer_id,null);
    assert.deepEqual((await db.query("select * from cotton_outbound_containers where booking_id=$1 and split_transfer_id is not null",[second])).rows,before);
    assert.equal((await db.query("select requested_bales from cotton_outbound_bookings where id=$1",[id])).rows[0].requested_bales,270);
  } finally { await db.close(); }
});
