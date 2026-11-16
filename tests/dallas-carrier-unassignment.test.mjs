import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadCase({ before = "CARRIER", after = null, writeFails = false, detail } = {}) {
  const calls = [];
  const order = carrier => ({
    id: "0830846", revenue_code_id: "DDRAY", customer_id: "CUSTOMER", booking_no_sucm: "2342071250",
    blnum: "MARK", curr_movement_id: "9001", movements: [{ id: "9001", carrier_id: carrier }],
  });
  const stops = [{ stop_type: "PU", location_id: "SCMDDETX" }, { stop_type: "SO", location_id: "UNIOWITX" }];
  const vendor = () => ({
    read: async path => {
      calls.push(path);
      if (path === "/movements/9001") return detail;
      const result = order(calls.length === 1 ? before : after);
      if (detail) delete result.movements[0].carrier_id;
      return result;
    },
    write: async path => {
      calls.push(path);
      if (writeFails) throw new Error("Request interrupted");
    },
  });
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../lib/dray/dallas-linked-order.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (name === "./server") return { vendor };
    if (name === "../inbound/checkin/yard-stop") return { mcleodOrderStops: () => stops };
    throw new Error(`Unexpected dependency ${name}`);
  }, module, module.exports);
  return { calls, clear: (carrier = "CARRIER", booking = "2342071250") =>
    module.exports.clearDallasCarrier("0830846", booking, { blnum: "FILE-1", payload: { customer_id: "CUSTOMER", stops } }, carrier) };
}

test("clears only the linked McLeod movement and verifies the result", async () => {
  const { calls, clear } = loadCase();
  await clear();
  assert.deepEqual(calls, [
    "/orders/0830846", "/carrierDispatch/clearCarrier/9001?reason=Outbound+load+plan+unassignment", "/orders/0830846",
  ]);
});

test("an already unassigned movement needs no write", async () => {
  const { calls, clear } = loadCase({ before: null });
  await clear();
  assert.deepEqual(calls, ["/orders/0830846"]);
});

test("a different live carrier or mismatched booking stops before mutation", async () => {
  const changed = loadCase({ before: "NEWCARRIER" });
  await assert.rejects(changed.clear(), /different carrier/);
  assert.equal(changed.calls.length, 1);
  const wrong = loadCase();
  await assert.rejects(wrong.clear("CARRIER", "OTHER-BOOKING"), /identity/);
  assert.equal(wrong.calls.length, 1);
});

test("requires read-back after a failed or ambiguous McLeod write", async () => {
  await loadCase({ writeFails: true }).clear();
  await assert.rejects(loadCase({ after: "CARRIER" }).clear(), /could not verify carrier removal/);
});


test("uses the current movement endpoint when the order omits carrier fields", async () => {
  const { calls, clear } = loadCase({ detail: { id: "9001", __brokerageStatusDescr: "Available" } });
  await clear();
  assert.deepEqual(calls, ["/orders/0830846", "/movements/9001"]);
});

test("an ambiguous movement response still blocks unassignment", async () => {
  const { calls, clear } = loadCase({ detail: { id: "9001" } });
  await assert.rejects(clear(), /did not return carrier assignment fields/);
  assert.deepEqual(calls, ["/orders/0830846", "/movements/9001"]);
});
