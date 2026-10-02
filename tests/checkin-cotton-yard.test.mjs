import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
test("processed SCM cotton completes the domestic line atomically and repairs existing rows",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create table inbound_checkin_rows(id int primary key,material_type text default 'cotton',movement_direction text default 'delivery',
      draft_status text default 'processed',matched_order_id text default 'ORDER1',processed_at timestamptz default '2026-10-02T16:00:00Z',
      verified_at timestamptz default '2026-10-02T15:59:00Z',yard_status text default 'working',yard_completed_at timestamptz);
      insert into inbound_checkin_rows(id) values(1);
      insert into inbound_checkin_rows(id,draft_status) values(2,'failed'),(3,'processing'),(4,'delivery_blocked'),(5,'outside_carrier');
      insert into inbound_checkin_rows(id,material_type) values(6,'lumber');
      insert into inbound_checkin_rows(id,movement_direction) values(7,'pickup');
      insert into inbound_checkin_rows(id,yard_status,yard_completed_at) values(8,'cancelled','2026-10-02T15:00:00Z'),(9,'completed','2026-10-02T15:00:00Z');`);
    await db.exec(readFileSync(new URL("../supabase/migrations/040_cotton_completion_yard_status.sql",import.meta.url),"utf8"));
    const rows=(await db.query("select *,yard_completed_at::text as stamp from inbound_checkin_rows order by id")).rows;
    assert.equal(rows[0].yard_status,"completed");assert.match(rows[0].stamp,/15:59:00/);
    for(const row of rows.slice(1,7)) assert.equal(row.yard_status,"working");
    assert.equal(rows[7].yard_status,"cancelled");assert.match(rows[8].stamp,/15:00:00/);
    await db.exec("update inbound_checkin_rows set draft_status='processed' where id=2");
    assert.equal((await db.query("select yard_status from inbound_checkin_rows where id=2")).rows[0].yard_status,"completed");
    await db.exec("update inbound_checkin_rows set verified_at=now() where id=2");
    assert.match((await db.query("select yard_completed_at::text as stamp from inbound_checkin_rows where id=2")).rows[0].stamp,/15:59:00/);
  } finally { await db.close(); }
});

test("Domestic Line accepts the atomic cotton completion without a second conflicting checkout",async()=>{
  const id="11111111-1111-4111-8111-111111111111";
  const row={id,terminal:"HOU",site_code:"5300",site_name:"Houston - 5300",updated_at:"version-1",
    material_type:"cotton",movement_direction:"delivery",yard_status:"working",draft_status:"checked_in",checked_in_at:"2026-10-02T14:00:00Z",
    mark:"MARK",shipper:"CUSTOMER",bol_bc:88,bale_count:88};
  const updates=[];let update;
  const query={select(){return this;},eq(){return this;},in(){return this;},update(value){update=value;updates.push(value);return this;},
    maybeSingle:async()=>({data:update?{...row,...update}:row})};
  const dependencies={
    "next/server":{NextResponse:Response},
    "@supabase/supabase-js":{createClient:()=>({from:()=>query})},
    "@/lib/auth/guard":{withStaffAccess:handler=>handler,staffActor:()=>"test staff"},
    "@/lib/inbound/checkin/sites":{CHECKIN_SITES:[{terminal:"HOU",siteCode:"5300",siteName:"Houston - 5300"}]},
    "@/lib/inbound/checkin/ready":{isCompleteCheckin:()=>true},
    "@/lib/inbound/checkin/shortage":{cottonShortage:()=>null},
    "@/lib/inbound/checkin/process-row":{processCheckinRow:async()=>({...row,draft_status:"processed",yard_status:"completed",yard_completed_at:"2026-10-02T16:00:00Z"})},
  };
  const source=ts.transpileModule(readFileSync(new URL("../app/api/warehouse/domestic-queue/route.ts",import.meta.url),"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function("require","module","exports",source)(name=>dependencies[name]??{},module,module.exports);
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://example.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test";
  try {
    const result=await module.exports.PATCH({headers:new Headers(),json:async()=>({action:"checkout",id,terminal:"HOU",siteCode:"5300",expectedUpdatedAt:row.updated_at,
      cotton:{mark:"MARK",customer:"CUSTOMER",bolBC:88,baleCount:88,warehouseLocation:"A",equipmentType:"V"}})});
    assert.equal(result.status,200);assert.equal((await result.json()).row.yard_status,"completed");
    assert.equal(updates.length,1,"only the receiving preparation should write; completion already happened atomically");
  } finally {
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
});
