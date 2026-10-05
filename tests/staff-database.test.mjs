import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
test("staff administration, invitation expiry, revocation and direct-database grants",async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create table inbound_checkin_rows(id uuid); grant all on inbound_checkin_rows to anon,authenticated; create function claim_inbound_checkin_row(uuid) returns boolean language sql as 'select true';");
    await db.exec(sql("042_staff_accounts.sql"));
    const admin=(await db.query("insert into scm_staff(email,name,role,status,user_id) values('admin@example.test','Admin','admin','active',gen_random_uuid()) returning *")).rows[0];
    const invite=(await db.query("select * from scm_manage_staff($1,'invite',null,'hou@example.test','Houston','operator','HOU')",[admin.id])).rows[0];
    await assert.rejects(db.query("select * from scm_manage_staff($1,'invite',null,'bad@example.test','Bad','operator','DAL')",[admin.id]));
    await assert.rejects(db.query("select * from scm_manage_staff($1,'invite',null,'duplicate@example.test','Nope','viewer',null)",[invite.id]));
    await assert.rejects(db.query("select * from scm_manage_staff($1,'disable',$1)",[admin.id]));
    const uuid="22222222-2222-4222-8222-222222222222";
    await db.query("update scm_staff set invite_expires_at=now()-interval '1 minute' where id=$1",[invite.id]);
    await assert.rejects(db.query("select * from scm_accept_staff($1,$2,'hou@example.test')",[invite.id,uuid]));
    await db.query("select * from scm_manage_staff($1,'resend',$2)",[admin.id,invite.id]);
    await assert.rejects(db.query("select * from scm_accept_staff($1,$2,'other@example.test')",[invite.id,uuid]));
    const accepted=(await db.query("select * from scm_accept_staff($1,$2,'hou@example.test')",[invite.id,uuid])).rows[0];
    assert.equal(accepted.status,"active");assert.equal(accepted.user_id,uuid);
    await db.query("select * from scm_manage_staff($1,'disable',$2)",[admin.id,invite.id]);
    await assert.rejects(db.query("select * from scm_accept_staff($1,$2,'hou@example.test')",[invite.id,uuid]));
    await assert.rejects(db.query("select * from scm_manage_staff($1,'resend',$2)",[admin.id,invite.id]));
    const grants=(await db.query("select has_table_privilege('authenticated','inbound_checkin_rows','select') as read,has_function_privilege('authenticated','claim_inbound_checkin_row(uuid)','execute') as execute,has_table_privilege('service_role','inbound_checkin_rows','select') as server_read")).rows[0];
    assert.deepEqual(grants,{read:false,execute:false,server_read:true});
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from scm_staff"));
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as count from scm_staff_activity")).rows[0].count,4);
  } finally { await db.close(); }
});

test("first admin bootstrap is repeatable while pending and refuses a second identity or an active admin",async()=>{
  const db=new PGlite(); try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(sql("042_staff_accounts.sql"));
    const first=(await db.query("select * from scm_bootstrap_staff('JAIME@example.test','Jaime')")).rows[0];
    assert.equal(first.role,'admin'); assert.equal(first.status,'pending');
    const retry=(await db.query("select * from scm_bootstrap_staff('jaime@example.test','Jaime')")).rows[0];
    assert.equal(retry.id,first.id);
    await assert.rejects(db.query("select * from scm_bootstrap_staff('other@example.test','Other')"));
    await db.query("select scm_accept_staff($1,gen_random_uuid(),'jaime@example.test')",[first.id]);
    await assert.rejects(db.query("select * from scm_bootstrap_staff('jaime@example.test','Jaime')"));
    assert.equal((await db.query("select has_function_privilege('authenticated','scm_bootstrap_staff(text,text)','execute') granted")).rows[0].granted,false);
  }finally{await db.close();}
});
