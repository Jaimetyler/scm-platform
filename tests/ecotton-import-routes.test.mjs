import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function route() {
  let writes = 0;
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "ready",
    source_hash: "same",
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(
    readFileSync("app/api/ecotton-import/route.ts", "utf8"),
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
    n === "@/lib/auth/guard"
      ? { withStaffAccess: (fn) => fn, staffActor: () => "admin" }
      : n === "@/lib/auth/session"
        ? { staffDatabase: () => ({}) }
        : n === "@/lib/ecotton/server"
          ? server
          : n === "@/lib/ecotton/engine"
            ? {
                processInvoice: async () => writes++,
                reconcileInvoice: async () => {},
              }
            : n === "@/lib/ecotton/delivery" ? {
              buildDeliveryPlan: () => ({}), deliverInvoice: async () => writes++, reconcileDelivery: async () => {},
            } : n.startsWith("@/lib/ecotton/")
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
  const oldI = process.env.ECOTTON_IMPORT_WRITES_ENABLED,
    oldM = process.env.MCLEOD_SYNC_ENABLED;
  try {
    for (const flags of [
      ["false", "true"],
      ["true", "false"],
      ["false", "false"],
    ]) {
      process.env.ECOTTON_IMPORT_WRITES_ENABLED = flags[0];
      process.env.MCLEOD_SYNC_ENABLED = flags[1];
      const r = route();
      const res = await r.handler({ json: async () => body });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /disabled/);
      assert.equal(r.writes(), 0);
    }
    process.env.ECOTTON_IMPORT_WRITES_ENABLED = "true";
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
    if (oldI === undefined) delete process.env.ECOTTON_IMPORT_WRITES_ENABLED;
    else process.env.ECOTTON_IMPORT_WRITES_ENABLED = oldI;
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
  const oldI=process.env.ECOTTON_IMPORT_WRITES_ENABLED, oldM=process.env.MCLEOD_SYNC_ENABLED;
  try {
    for (const [imp,sync] of [["false","true"],["true","false"]]) {
      process.env.ECOTTON_IMPORT_WRITES_ENABLED=imp;process.env.MCLEOD_SYNC_ENABLED=sync;
      const r=route();r.row.status="verified";
      const res=await r.handler({json:async()=>({...body,action:"deliver"})});
      assert.equal(res.status,400);assert.match((await res.json()).error,/disabled/);assert.equal(r.writes(),0);
    }
    process.env.ECOTTON_IMPORT_WRITES_ENABLED="true";process.env.MCLEOD_SYNC_ENABLED="true";
    for (const override of [{confirmed:false},{planHash:"stale"},{rowId:"33333333-3333-4333-8333-333333333333"}]) {
      const r=route();r.row.status="verified";const res=await r.handler({json:async()=>({...body,action:"deliver",...override})});assert.equal(res.status,400);assert.equal(r.writes(),0);
    }
    const r=route();r.row.status="verified";
    const res=await r.handler({json:async()=>({...body,action:"deliver",planHash:"reviewed"})});assert.equal(res.status,200);assert.equal(r.writes(),1);
  } finally {
    if(oldI===undefined)delete process.env.ECOTTON_IMPORT_WRITES_ENABLED;else process.env.ECOTTON_IMPORT_WRITES_ENABLED=oldI;
    if(oldM===undefined)delete process.env.MCLEOD_SYNC_ENABLED;else process.env.MCLEOD_SYNC_ENABLED=oldM;
  }
});
