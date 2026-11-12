import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function route({ newlyRated = false, orderedBy = "ECOTTON", eligible = true } = {}) {
  let writes = 0;
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "ready",
    source_hash: "same",
    profile: { orderedBy },
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
                processInvoice: async () => {
                  writes++;
                  if (newlyRated) return { ...row, status: "verified", order_id: "123" };
                },
                reconcileInvoice: async () => {},
              }
            : n === "@/lib/ecotton/delivery" ? {
              supportsDelivery: () => eligible, buildDeliveryPlan: () => ({}), deliverInvoice: async () => writes++, reconcileDelivery: async () => {},
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

test("combined delivery requires an eligible warehouse and a row rated by this request", async () => {
  const keys = ["ECOTTON_IMPORT_WRITES_ENABLED", "MCLEOD_SYNC_ENABLED"];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = "true";
    for (const [orderedBy, newlyRated, eligible, status, writes] of [
      ["ECOTTON", true, false, 400, 0],
      ["ECOTTON", true, true, 200, 2],
      ["GIN DIRECT", false, true, 200, 1],
      ["GIN DIRECT", true, true, 200, 2],
    ]) {
      const r = route({ orderedBy, newlyRated, eligible });
      const response = await r.handler({ json: async () => ({ ...body, action: "execute-and-deliver" }) });
      assert.equal(response.status, status);
      assert.equal(r.writes(), writes);
    }
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
});
