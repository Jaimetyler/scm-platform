import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { dallasImportPayload, matchesDallasImportDate, stagedDallasLocalTime } from "../lib/dray/dallas-import-orders.ts";
import { planOutboundDrayLoads } from "../lib/dray/outbound-load-plan.ts";

test("Dallas import stages numbered blank loads and rolls back a duplicate Book ID", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table inbound_checkin_rows(id uuid primary key,mark text,checked_in_at timestamptz,material_type text,movement_direction text,yard_status text,terminal text,site_code text,site_name text);
      create table warehouse_inventory_lots(mark text,terminal text,site_code text,inventory_status text,current_bales integer,allocated_bales integer);`);
    for (const name of [
      "030_cotton_outbound_booking_drafts", "031_cotton_outbound_containers", "032_cotton_outbound_mark_planning",
      "033_outbound_automatic_mark_assignment", "034_cotton_outbound_bulk_rollover", "035_outbound_booking_details_and_split_history",
      "036_outbound_import_sailing_details", "039_outbound_mark_lifecycle_and_source_loads", "041_outbound_scm_file_number",
      "20261107044221_outbound_booking_return_location", "20261111165754_outbound_steamship_line_and_load_counts",
      "20261114030000_dallas_dray_import", "20261114033000_restore_dallas_dray_import",
    ]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
    const dallasMigration = await readFile(new URL("../supabase/migrations/20261106193215_dallas_warehouse_sites.sql", import.meta.url), "utf8");
    await db.exec(dallasMigration.match(/alter table public.cotton_outbound_bookings[\s\S]*?;/i)[0]);
    await db.exec("alter table cotton_outbound_containers add column carrier_plan jsonb");
    for (const name of [
      "20261113141000_outbound_booking_uncovered", "20261113153000_outbound_booking_carrier_breakdown",
      "20261117150000_outbound_booking_identifiers", "20261117153000_outbound_import_scm_file_number",
    ]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
    const stage = (booking, restoreId, bookId = "41458") => {
      const loads = planOutboundDrayLoads(bookId, 2, "SCMDDETX", "BNSFHATX");
      const payloads = loads.map(load => dallasImportPayload(load, booking, "BUNGOMNE", "2026-11-13", "2026-11-18T17:25", { bookId, steamshipLine: "ORIENT OVERSEAS CONTAINER LINE LIMITED", docCutoff: "2026-11-16T10:30" }));
      assert.equal(payloads[0].order_type_id, "FSCD");
      assert.equal(payloads[0].booking_no_sucm, booking);
      assert.equal(payloads[0].ssl_sucm, "OOCL");
      assert.equal(payloads[0].cutoff_date, "2026-11-18T17:25:00");
      assert.equal(payloads[0].doc_cutoff_date, "2026-11-16T10:30:00");
      assert.equal(payloads[0].planning_comment, `ID${bookId}: OOCL Bkg# ${booking} - ERD 11/13 - C/O 11/18 *Bolt Seals Required*`);
      assert.match(payloads[0].stops[0].sched_arrive_late, /^2026-11-18T17:25:00$/);
      assert.equal(payloads[0].consignee_refno, undefined);
      assert.equal(payloads[0].movements, undefined);
      return db.query(`select start_dallas_dray_import('SCMDDETX','Dallas - 2119','Bunge USA Agriculture LLC',$1,'61028280','request.xlsx',$2,$3,$4)`, [
        booking, JSON.stringify([{ sourceRow: 1, mark: "MARK-A", bales: 90, confirmed: false, warehouse: "Dallas" }]),
        JSON.stringify({ book_id: bookId, restore_booking_id: restoreId, doc_cutoff_has_time: false, cutoff: "2026-11-18T17:25", cutoff_has_time: true }),
        JSON.stringify(payloads),
      ]);
    };
    await db.exec("alter table cotton_outbound_containers add constraint outbound_carrier_plan_requires_load check (carrier_plan is null or booking_line_id is not null or container_number is not null)");
    await db.exec(await readFile(new URL("../supabase/migrations/20261114090000_outbound_carrier_for_verified_order.sql", import.meta.url), "utf8"));
    await stage("BOOKING-1");
    assert.deepEqual((await db.query("select blnum,state from dallas_dray_import_loads order by sequence_no")).rows,
      [{ blnum: "41458-1", state: "pending" }, { blnum: "41458-2", state: "pending" }]);
    assert.equal((await db.query("select booking_line_id from cotton_outbound_containers where booking_line_id is not null")).rows.length, 0);
    assert.equal((await db.query("select mark from cotton_outbound_booking_lines")).rows[0].mark, "MARK-A");
    assert.deepEqual((await db.query("select book_id, scm_file_number, customer_reference from cotton_outbound_booking_search_dashboard")).rows,
      [{ book_id: "41458", scm_file_number: null, customer_reference: "61028280" }]);
    const saveCarrier = () => db.exec("update cotton_outbound_containers set carrier_plan = '{}'::jsonb where sequence_no = 1");
    await assert.rejects(saveCarrier(), /verified SCM order/);
    await db.exec("update dallas_dray_import_loads set state = 'verified', order_id = '0830845' where blnum = '41458-1'");
    await saveCarrier();
    await assert.rejects(stage("BOOKING-2"), /duplicate key/);
    assert.equal((await db.query("select id from cotton_outbound_bookings")).rows.length, 1);
    const legacy = (await db.query(`select create_cotton_outbound_booking_draft(
      'DAL','SCMDDETX','Dallas - 2119','Bunge','LEGACY','',2,90,'request.xlsx',
      '[{"sourceRow":1,"mark":"LEGACY-MARK","bales":90,"confirmed":false,"warehouse":"Dallas"}]') id`)).rows[0].id;
    await db.query("update cotton_outbound_bookings set status='cancelled' where id=$1", [legacy]);
    await assert.rejects(stage("LEGACY", legacy), /duplicate key/);
    assert.equal((await db.query("select status from cotton_outbound_bookings where id=$1", [legacy])).rows[0].status, "cancelled");
    await stage("LEGACY", legacy, "41459");
    assert.deepEqual((await db.query("select status, book_id, scm_file_number, customer_reference from cotton_outbound_bookings where id=$1", [legacy])).rows,
      [{ status: "draft", book_id: "41459", scm_file_number: null, customer_reference: "61028280" }]);
    const sourceBales = [
      { sourceRow: 18, warehouse: "Moody #02", warehouseCode: "858054", bales: 70 },
      { sourceRow: 19, warehouse: "Moody #04", warehouseCode: "858056", bales: 16 },
    ];
    const houston = (await db.query(`select create_cotton_outbound_booking_import(
      'HOU','5300','Houston','Bunge','RICGEN524500','61014910',1,86,'request.xlsx',$1,$2) id`, [
      JSON.stringify([{ sourceRow: 18, mark: "C0986", bales: 86, confirmed: true, warehouse: "Moody #02", sourceBales }]),
      JSON.stringify({ book_id: "41503", scm_file_number: "SCM-123", steamship_line: "ONE" }),
    ])).rows[0].id;
    assert.deepEqual((await db.query("select requested_bales, source_bales from cotton_outbound_booking_lines where booking_id=$1", [houston])).rows,
      [{ requested_bales: 86, source_bales: sourceBales }]);
    assert.deepEqual((await db.query("select book_id, scm_file_number, customer_reference, planned_containers from cotton_outbound_booking_search_dashboard where id=$1", [houston])).rows,
      [{ book_id: "41503", scm_file_number: "SCM-123", customer_reference: "61014910", planned_containers: 1 }]);
    assert.equal((await db.query("select count(*)::int n from dallas_dray_import_loads where booking_id=$1", [legacy])).rows[0].n, 2);
  } finally { await db.close(); }
});

test("Dallas order timestamps preserve the displayed local time", () => {
  assert.equal(stagedDallasLocalTime("20261118000000-0600"), "2026-11-18T00:00:00");
  assert.equal(matchesDallasImportDate("20261118010000-0500", "2026-11-18T00:00:00"), false);
  assert.equal(matchesDallasImportDate("20261118172500-0500", "2026-11-18T17:25:00"), true);
});
