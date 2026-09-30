import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { cottonShortage, shortageAcknowledged, acknowledgeShortage } from "../lib/inbound/checkin/shortage.ts";
import { isCompleteCheckin, isReadyCheckin } from "../lib/inbound/checkin/ready.ts";
import { currentCottonOrder } from "../lib/inbound/checkin/current-cotton-order.ts";
import { bookingBaleDisplay } from "../lib/warehouse/outbound/bale-display.ts";

const complete = { terminal: "SAV", site_code: "984", site_name: "Savannah 984", sub_location: "MAIN",
  received_date: "2026-09-30", mark: "D0178", shipper: "BUNGE", bol_bc: 89, bale_count: 87,
  warehouse_location: "K11", equipment_type: "V" };

test("shortage acknowledgement permits receiving completeness without permitting delivery", () => {
  assert.deepEqual(cottonShortage(complete), { expected: 89, received: 87, missing: 2 });
  assert.equal(isCompleteCheckin(complete), true);
  assert.equal(isReadyCheckin(complete), false);
  const ack = acknowledgeShortage(complete, "Two bales missing; customer follow-up pending", "Jaime", "2026-09-30T17:00:00Z");
  assert.equal(shortageAcknowledged({ ...complete, ...ack }), true);
  assert.equal(isReadyCheckin({ ...complete, ...ack }), false);
  assert.equal(shortageAcknowledged({ ...complete, ...ack, bale_count: 86 }), false);
  assert.throws(() => acknowledgeShortage(complete, " ", "Jaime", "now"), /note/);
});

test("QR reported count is distinct from staff confirmed unloading and order count is authoritative", () => {
  assert.deepEqual(cottonShortage({ bol_bc: 87, expected_bale_count: 90 }), { expected: 90, received: 87, missing: 3 });
  assert.deepEqual(cottonShortage({ bol_bc: 90, driver_reported_bales: 88 }), { expected: 90, received: 88, missing: 2 });
  assert.equal(cottonShortage({ bol_bc: 90, driver_reported_bales: 88, bale_count: 90 }), null);
  assert.equal(cottonShortage({ bol_bc: 90, bale_count: 88, material_type: "lumber" }), null);
  assert.equal(cottonShortage({ bol_bc: 90, bale_count: 88, movement_direction: "pickup" }), null);
  assert.deepEqual(cottonShortage({ bol_bc: 90, driver_reported_bales: 0 }), { expected: 90, received: 0, missing: 90 });
});

test("current-order matching excludes delivered and old orders and requires date evidence", () => {
  const order = { stops: [{ stop_type: "SO", sched_arrive_early: "20260930120000-0400" }] };
  assert.equal(currentCottonOrder(order, "2026-09-30").eligible, true);
  assert.equal(currentCottonOrder({ stops: [{ ...order.stops[0], actual_departure: "20260930140000" }] }, "2026-09-30").eligible, false);
  assert.equal(currentCottonOrder({ stops: [{ stop_type: "SO", sched_arrive_early: "20250330120000" }] }, "2026-09-30").historical, true);
  assert.equal(currentCottonOrder({ stops: [{ stop_type: "SO" }] }, "2026-09-30").historical, false);
  assert.equal(currentCottonOrder({ stops: [{ stop_type: "SO", sched_arrive_early: "20260230" }] }, "2026-09-30").eligible, false);
});

test("booking bale slot shows a green match or a red received-of-expected value", () => {
  assert.equal(bookingBaleDisplay({ requested_bales: 90, available_bales: 90, inbound_bales: 90 }).text, "90");
  assert.equal(bookingBaleDisplay({ requested_bales: 90, available_bales: 90, inbound_bales: 90 }).color, "#4ade80");
  assert.equal(bookingBaleDisplay({ requested_bales: 90, available_bales: 87, inbound_bales: 0 }).text, "87 of 90");
  assert.equal(bookingBaleDisplay({ requested_bales: 90, available_bales: 0, inbound_bales: 87 }).color, "#f87171");
  assert.equal(bookingBaleDisplay({ requested_bales: 90, mark_requested_total: 180, available_bales: 180, inbound_bales: 0 }).text, "180");
});

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const name of ["006_inbound_checkin_rows.sql", "007_inbound_checkin_processing.sql", "008_inbound_checkin_verified_at.sql",
    "009_inbound_checkin_outside_carrier.sql", "021_warehouse_inventory.sql", "022_driver_self_checkin.sql", "023_driver_bol_photos.sql", "026_domestic_gate_queue.sql", "037_inbound_cotton_shortages.sql"])
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  return db;
}

test("database allows a short arrival, requires acknowledgement, blocks delivery, and receipts only actual bales", async () => {
  const db = await database();
  try {
    const { rows } = await db.query(`insert into inbound_checkin_rows(terminal,site_code,site_name,sub_location,received_date,mark,shipper,bol_bc,bale_count,warehouse_location,equipment_type,draft_status)
      values('SAV','984','Savannah 984','MAIN','2026-09-30','D0178','BUNGE',89,87,'K11','V','checked_in') returning id`);
    const id = rows[0].id;
    for (const status of ["ready", "processing", "processed", "outside_carrier"]) await assert.rejects(db.query("update inbound_checkin_rows set draft_status=$2 where id=$1", [id, status]), /cannot post McLeod/);
    await assert.rejects(db.query("update inbound_checkin_rows set draft_status='delivery_blocked' where id=$1", [id]), /acknowledge/);
    await db.query(`update inbound_checkin_rows set shortage_acknowledged_at=now(),shortage_acknowledged_by='Jaime',shortage_expected_bales=89,shortage_received_bales=87,shortage_note='Two bales missing',draft_status='delivery_blocked' where id=$1`, [id]);
    const row = (await db.query("select * from inbound_checkin_rows where id=$1", [id])).rows[0];
    assert.ok(row.checkin_completed_at);
    assert.equal(row.processed_at, null);
    assert.equal((await db.query("select * from claim_inbound_checkin_row($1)", [id])).rows.length, 0);
    const lot = (await db.query("select * from warehouse_inventory_lots where source_checkin_id=$1", [id])).rows[0];
    assert.equal(lot.original_bales, 87); assert.equal(lot.current_bales, 87); assert.equal(lot.missing_bales, 0);
    await db.query("update inbound_checkin_rows set comment_1='Customer emailed about two missing bales',customer_notified_at=now(),customer_notified_by='Jaime' where id=$1", [id]);
    assert.equal((await db.query("select * from warehouse_inventory_lots where source_checkin_id=$1", [id])).rows.length, 1);
    assert.deepEqual((await db.query("select event_type from inbound_shortage_events where checkin_id=$1 order by created_at", [id])).rows.map((event) => event.event_type), ["acknowledged", "customer_notified"]);
    await assert.rejects(db.query("update inbound_checkin_rows set bale_count=86 where id=$1", [id]), /acknowledge/);
    await assert.rejects(db.query("update inbound_checkin_rows set draft_status='ready',bale_count=89 where id=$1", [id]), /remains blocked/);
    await db.exec(await readFile(new URL("../supabase/migrations/037_inbound_cotton_shortages.sql", import.meta.url), "utf8"));
  } finally { await db.close(); }
});

test("changing counts before receiving resets acknowledgement and customer notification", async () => {
  const db = await database();
  try {
    const { rows } = await db.query(`insert into inbound_checkin_rows(terminal,site_code,site_name,mark,shipper,bol_bc,driver_reported_bales,draft_status,
      shortage_acknowledged_at,shortage_acknowledged_by,shortage_expected_bales,shortage_received_bales,shortage_note,customer_notified_at)
      values('SAV','984','Savannah 984','TEST','BUNGE',90,88,'checked_in',now(),'Jaime',90,88,'Short at arrival',now()) returning id`);
    await db.query("update inbound_checkin_rows set bale_count=87 where id=$1", [rows[0].id]);
    const row = (await db.query("select * from inbound_checkin_rows where id=$1", [rows[0].id])).rows[0];
    assert.equal(row.shortage_acknowledged_at, null); assert.equal(row.customer_notified_at, null);
    assert.equal((await db.query("select * from warehouse_inventory_lots")).rows.length, 0);
  } finally { await db.close(); }
});
