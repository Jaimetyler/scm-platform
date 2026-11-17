import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function route(ratedState = "verified") {
  let writes = 0;
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "ready",
    source_hash: "same",
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(
    readFileSync("app/api/dray-import/route.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const server = {
    readRun: async () => ({
      run: { id: "22222222-2222-4222-8222-222222222222" },
      items: [
        { order_id: row.id, source_hash: "same", conflict: false, order: row },
      ],
    }),
    databaseStore: () => ({}),
    vendor: () => ({ read: async () => ({}) }),
    hash: () => "reviewed",
  };
  const local = (n) =>
    n === "@/lib/dray-bols/source" ? {bolBales:()=>[]} : n === "@/lib/auth/guard"
      ? { withStaffAccess: (fn) => fn, staffActor: () => "admin" }
      : n === "@/lib/auth/session"
        ? { staffDatabase: () => ({}) }
        : n === "@/lib/dray/server"
          ? server
          : n === "@/lib/dray/engine"
            ? {
                processInvoice: async () => { writes++; row.status = ratedState; row.order_id = "0830001"; },
                repairCreatedInvoice: async () => writes++,
                reconcileInvoice: async () => {},
              }
            : n === "@/lib/dray/delivery" ? {
              buildDeliveryPlan: () => ({}), deliverInvoice: async () => { writes++; row.status = "delivered"; }, reconcileDelivery: async () => {},
            } : n === "@/lib/sharepoint/e2open-documents" ? {} : n.startsWith("@/lib/dray/")
              ? { PROFILES: [{ id: "HOU", confirmed: true }] }
              : require(n);
  new Function("require", "module", "exports", code)(local, mod, mod.exports);
  return { handler: mod.exports.POST, writes: () => writes, row };
}
const body = {
  action: "execute",
  confirmed: true,
  runId: "22222222-2222-4222-8222-222222222222",
  rowId: "11111111-1111-4111-8111-111111111111",
};
test("new import writes require both flags, saved membership and explicit review", async () => {
  const oldI = process.env.DRAY_IMPORT_WRITES_ENABLED,
    oldM = process.env.MCLEOD_SYNC_ENABLED;
  try {
    for (const flags of [
      ["false", "true"],
      ["true", "false"],
      ["false", "false"],
    ]) {
      process.env.DRAY_IMPORT_WRITES_ENABLED = flags[0];
      process.env.MCLEOD_SYNC_ENABLED = flags[1];
      const r = route();
      const res = await r.handler({ json: async () => body });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /disabled/);
      assert.equal(r.writes(), 0);
    }
    process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
    process.env.MCLEOD_SYNC_ENABLED = "true";
    const r = route();
    assert.equal(
      (await r.handler({ json: async () => ({ ...body, confirmed: false }) }))
        .status,
      400,
    );
    assert.equal(
      (
        await r.handler({
          json: async () => ({
            ...body,
            rowId: "33333333-3333-4333-8333-333333333333",
          }),
        })
      ).status,
      400,
    );
    assert.equal(r.writes(), 0);
  } finally {
    if (oldI === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = oldI;
    if (oldM === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = oldM;
  }
});
test("fresh in-flight claims cannot be reconciled while a request might still be writing", async () => {
  const r = route();
  Object.assign(r.row, {
    status: "creating",
    updated_at: new Date().toISOString(),
  });
  const res = await r.handler({
    json: async () => ({ ...body, action: "reconcile" }),
  });
  assert.match((await res.json()).error, /five minutes/);
  assert.equal(r.writes(), 0);
});

test("delivery requires saved membership, both write flags, reviewed plan hash and confirmation", async () => {
  const oldI=process.env.DRAY_IMPORT_WRITES_ENABLED, oldM=process.env.MCLEOD_SYNC_ENABLED;
  try {
    for (const [imp,sync] of [["false","true"],["true","false"]]) {
      process.env.DRAY_IMPORT_WRITES_ENABLED=imp;process.env.MCLEOD_SYNC_ENABLED=sync;
      const r=route();r.row.status="verified";
      const res=await r.handler({json:async()=>({...body,action:"deliver"})});
      assert.equal(res.status,400);assert.match((await res.json()).error,/disabled/);assert.equal(r.writes(),0);
    }
    process.env.DRAY_IMPORT_WRITES_ENABLED="true";process.env.MCLEOD_SYNC_ENABLED="true";
    for (const override of [{confirmed:false},{planHash:"stale"},{rowId:"33333333-3333-4333-8333-333333333333"}]) {
      const r=route();r.row.status="verified";const res=await r.handler({json:async()=>({...body,action:"deliver",...override})});assert.equal(res.status,400);assert.equal(r.writes(),0);
    }
    const r=route();r.row.status="verified";
    const res=await r.handler({json:async()=>({...body,action:"deliver",planHash:"reviewed"})});assert.equal(res.status,200);assert.equal(r.writes(),1);
  } finally {
    if(oldI===undefined)delete process.env.DRAY_IMPORT_WRITES_ENABLED;else process.env.DRAY_IMPORT_WRITES_ENABLED=oldI;
    if(oldM===undefined)delete process.env.MCLEOD_SYNC_ENABLED;else process.env.MCLEOD_SYNC_ENABLED=oldM;
  }
});

test("existing-order repair requires explicit confirmation and both write flags",async()=>{
 const oldI=process.env.DRAY_IMPORT_WRITES_ENABLED,oldM=process.env.MCLEOD_SYNC_ENABLED;
 try {
 for(const [imp,sync,confirmed] of [["false","true",true],["true","false",true],["true","true",false]]) {
 process.env.DRAY_IMPORT_WRITES_ENABLED=imp;process.env.MCLEOD_SYNC_ENABLED=sync;const r=route();
 const res=await r.handler({json:async()=>({...body,action:"repair-created",confirmed})});assert.equal(res.status,400);assert.equal(r.writes(),0);
 }
 }finally{if(oldI===undefined)delete process.env.DRAY_IMPORT_WRITES_ENABLED;else process.env.DRAY_IMPORT_WRITES_ENABLED=oldI;if(oldM===undefined)delete process.env.MCLEOD_SYNC_ENABLED;else process.env.MCLEOD_SYNC_ENABLED=oldM}
});

test("combined import delivers only after successful rating read-back", async () => {
  const original = { DRAY_IMPORT_WRITES_ENABLED: process.env.DRAY_IMPORT_WRITES_ENABLED, MCLEOD_SYNC_ENABLED: process.env.MCLEOD_SYNC_ENABLED };
  Object.assign(process.env, { DRAY_IMPORT_WRITES_ENABLED: "true", MCLEOD_SYNC_ENABLED: "true" });
  try {
    for (const [ratingResult, finalStatus, writes] of [["verified", "delivered", 2], ["blocked", "blocked", 1]]) {
      const r = route(ratingResult);
      const res = await r.handler({ json: async () => ({ ...body, action: "execute-and-deliver" }) });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).items[0].order.status, finalStatus);
      assert.equal(r.writes(), writes);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("import review ranks interchange evidence and preserves the source key", async () => {
  const { reviewDrayInvoice, interchangeContainerMatches } = await import("../lib/dray/review.ts");
  const invoice = { booking:"4.04641E+11", container:"EGHU8429982", mark:"EGHU8429982", carrierCents:null,
    firstStarLoad:null, sourceKey:"218268:EGHU8429982", inputErrors:["No FirstStar container match"] };
  assert.throws(() => reviewDrayInvoice(invoice, { ...invoice, carrierPay:"200" }), /exact booking/);
  const corrected = reviewDrayInvoice(invoice, { booking:"404641123456", container:"EGHU9429982", carrierPay:"200.00" });
  assert.equal(corrected.sourceKey, invoice.sourceKey);
  assert.equal(corrected.mark, "EGHU9429982");
  assert.equal(corrected.carrierCents, 20000);
  assert.deepEqual(corrected.inputErrors, []);
  assert.throws(() => reviewDrayInvoice({ ...invoice, inputErrors:["Unknown port terminal: XXX"] },
    { booking:"404641123456", container:"EGHU9429982", carrierPay:"200.00" }), /Unknown port/);
  const matches = interchangeContainerMatches(invoice.container, [
    "EGHU8507545_in.pdf", "EGHU9429982_out.pdf", "eghu9429982_IN.pdf", "BOL.pdf",
  ]);
  assert.deepEqual(matches[0], { container:"EGHU9429982", documents:["in","out"], differences:1 });
});

test("review migration keeps BOL identity, fences concurrent edits, and prevents a second effective container", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(readFileSync("supabase/migrations/20261103191637_dray_import_ledger.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261117172000_savannah_dray_import_review.sql", "utf8"));
    const original = { sourceKey:"218268:EGHU8429982", shippingOrder:"218268", container:"EGHU8429982", inputErrors:["No FirstStar container match"] };
    const seeded = await db.query("insert into dray_import_orders(terminal,location,reference,invoice,profile,source_hash,status) values ('SAV','SAVWHSE',$1,$2,'{}','source','preview_blocked') returning id",
      [original.sourceKey, JSON.stringify(original)]);
    const id = seeded.rows[0].id;
    const corrected = {...original, container:"EGHU9429982", inputErrors:[], carrierCents:20000};
    const save = () => db.query("select review_savannah_dray_import($1,0,$2,'qa') as saved",[id,JSON.stringify(corrected)]);
    assert.equal((await save()).rows[0].saved,true);
    assert.equal((await save()).rows[0].saved,false);
    const {rows} = await db.query("select status,source_hash,invoice from dray_import_orders where id=$1",[id]);
    assert.equal(rows[0].status,"ready");
    assert.equal(rows[0].source_hash,"source");
    assert.equal(rows[0].invoice.sourceKey,original.sourceKey);
    await assert.rejects(db.query("insert into dray_import_orders(terminal,location,reference,invoice,profile,source_hash,status) values ('SAV','SAVWHSE','218268:EGHU9429982',$1,'{}','new','ready')",
      [JSON.stringify(corrected)]), /dray_import_effective_container_key/);
  } finally { await db.close(); }
});
