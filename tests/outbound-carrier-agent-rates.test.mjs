import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("carrier agents at the same yard and delivery can have distinct rates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table cotton_outbound_containers(container_number text, split_transfer_id uuid);`);
    const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    await db.exec(await migration("20261112170000_outbound_carrier_rates.sql"));
    const insert = (name, daily) => db.query(
      `insert into outbound_carrier_rates(terminal,site_code,carrier_id,carrier_name,lane,rates,updated_by)
       values ('HOU','5300','QFSTGRIN',$1,'HOUPORT',jsonb_build_object('daily',$2::int),'test')`, [name, daily]);
    await insert("Dee", 4500);
    await db.exec(await migration("20261113190000_outbound_carrier_agent_rates.sql"));
    await insert("Rik", 4000);
    await assert.rejects(insert(" dee ", 5000), { code: "23505" });
    const { rows } = await db.query("select carrier_name, rates from outbound_carrier_rates order by carrier_name");
    assert.deepEqual(rows, [{ carrier_name: "Dee", rates: { daily: 4500 } }, { carrier_name: "Rik", rates: { daily: 4000 } }]);
  } finally { await db.close(); }
});
