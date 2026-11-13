import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("uncovered counts open booking slots without a carrier, including slots without equipment", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table cotton_outbound_booking_dashboard(id integer);
      create table cotton_outbound_bookings(id integer, scm_file_number text, return_location text, return_location_code text, steamship_line text);
      create table cotton_outbound_booking_lines(id integer, booking_id integer, mark text, line_status text);
      create table cotton_outbound_containers(booking_id integer, booking_line_id integer, container_number text, split_transfer_id integer, carrier_plan jsonb);
      insert into cotton_outbound_booking_dashboard values (1), (2);
      insert into cotton_outbound_bookings(id) values (1), (2);
      insert into cotton_outbound_booking_lines values (1,1,'A','active'),(2,1,'B','on_hold'),(3,1,'C','cancelled');
      insert into cotton_outbound_containers values
        (1,1,null,null,null), (1,null,null,null,null),
        (1,1,null,null,'{"rate":{"carrier_id":"SCMIRIGA"}}'),
        (1,2,null,null,null), (1,3,null,null,null), (1,null,null,9,null),
        (2,null,null,null,'{"rate":{"carrier_id":"SCMIRIGA"}}');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/20261113141000_outbound_booking_uncovered.sql", import.meta.url), "utf8"));
    await db.exec(`insert into cotton_outbound_containers values
      (1,1,null,null,'{"rate":{"carrier_id":"scmiriga","carrier_name":"SCMI"}}'),
      (1,2,null,null,'{"rate":{"carrier_id":"HOLD"}}'),
      (1,null,null,9,'{"rate":{"carrier_id":"SPLIT"}}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261113153000_outbound_booking_carrier_breakdown.sql", import.meta.url), "utf8"));
    const breakdown = await db.query("select carrier_breakdown from cotton_outbound_booking_search_dashboard order by id");
    assert.deepEqual(breakdown.rows.map(row => row.carrier_breakdown), [
      [{ code: "SCMIRIGA", name: "SCMI", count: 2 }],
      [{ code: "SCMIRIGA", name: null, count: 1 }],
    ]);
    const result = await db.query("select uncovered_containers from cotton_outbound_booking_search_dashboard order by id");
    assert.deepEqual(result.rows.map(row => row.uncovered_containers), [2, 0]);
  } finally { await db.close(); }
});
