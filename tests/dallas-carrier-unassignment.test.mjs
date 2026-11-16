import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as extraPay from "../lib/dray/dallas-extra-pay.ts";

function loadCase({ before = "CARRIER", after = null, writeFails = false, detail, extraPayRows = [], blnums = ["MARK"], containers = [""], status = "A" } = {}) {
  const calls = [];
  const writes = [];
  let reads = 0;
  let rows = [...extraPayRows];
  const order = carrier => ({
    id: "0830846", revenue_code_id: "DDRAY", customer_id: "CUSTOMER", booking_no_sucm: "2342071250",
    blnum: blnums[Math.min(reads - 1, blnums.length - 1)],
    consignee_refno: containers[Math.min(reads - 1, containers.length - 1)], status, curr_movement_id: "9001", movements: [{ id: "9001", carrier_id: carrier }],
  });
  const stops = [{ stop_type: "PU", location_id: "SCMDDETX" }, { stop_type: "SO", location_id: "UNIOWITX" }];
  const vendor = () => ({
    read: async path => {
      calls.push(path);
      if (path === "/movements/9001") return detail;
      if (path === "/movements/9001/otherPay") return rows;
      const result = order(reads++ === 0 ? before : after);
      if (detail) delete result.movements[0].carrier_id;
      return result;
    },
    deleteOtherPay: async id => { calls.push(`delete ${id}`); rows = rows.filter(row => row.id !== id); },
    write: async (path, body) => {
      calls.push(path);
      writes.push(body);
      if (writeFails) throw new Error("Request interrupted");
    },
  });
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../lib/dray/dallas-linked-order.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (name === "./dallas-extra-pay") return extraPay;
    if (name === "./server") return { vendor };
    if (name === "../inbound/checkin/yard-stop") return { mcleodOrderStops: () => stops };
    throw new Error(`Unexpected dependency ${name}`);
  }, module, module.exports);
  return { calls, writes, prepareBlnumReset: () =>
    module.exports.prepareDallasBlnumReset("0830846", "2342071250", { blnum: "FILE-1", payload: { customer_id: "CUSTOMER", stops } }),
    clear: (carrier = before, booking = "2342071250") =>
    module.exports.clearDallasCarrier("0830846", booking, { blnum: "FILE-1", payload: { customer_id: "CUSTOMER", stops } }, carrier ? { rate: { carrier_id: carrier, rates: { base: { pay: 0 }, chassisDays: { pay: 0 }, chassisSplits: { pay: 0 }, stopoffs: { pay: 0 } } }, quantities: { chassisDays: 0, chassisSplits: 0, stopoffs: 0 } } : null) };
}

test("clears only the linked McLeod movement and verifies the result", async () => {
  const { calls, clear } = loadCase();
  await clear();
  assert.deepEqual(calls, [
    "/orders/0830846", "/movements/9001/otherPay", "/carrierDispatch/clearCarrier/9001?reason=Outbound+load+plan+unassignment", "/orders/0830846",
  ]);
});

test("an already unassigned movement needs no write", async () => {
  const { calls, clear } = loadCase({ before: null });
  await clear();
  assert.deepEqual(calls, ["/orders/0830846"]);
});

test("a different live carrier or mismatched booking stops before mutation", async () => {
  const changed = loadCase({ before: "NEWCARRIER" });
  await assert.rejects(changed.clear("CARRIER"), /different carrier/);
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
  const { calls, clear } = loadCase({ before: null, detail: { id: "9001", __brokerageStatusDescr: "Available" } });
  await clear();
  assert.deepEqual(calls, ["/orders/0830846", "/movements/9001"]);
});

test("an ambiguous movement response still blocks unassignment", async () => {
  const { calls, clear } = loadCase({ before: null, detail: { id: "9001" } });
  await assert.rejects(clear(), /did not return carrier assignment fields/);
  assert.deepEqual(calls, ["/orders/0830846", "/movements/9001"]);
});


test("clears only matching tagged pay lines after dispatch removal", async () => {
  const pay = { movement_id: "9001", order_id: "0830846", payee_id: "CARRIER", deduct_code_id: "001", amount: 20 };
  const { calls, clear } = loadCase({ extraPayRows: [
    { ...pay, id: "expected", reference_no: extraPay.dallasExtraPayReference },
    { ...pay, id: "manual" },
    { ...pay, id: "other-order", order_id: "different", reference_no: extraPay.dallasExtraPayReference },
  ] });
  await clear();
  assert.deepEqual(calls.filter(call => call.startsWith("delete ")), ["delete expected"]);
});

test("uses the current Dallas calendar day in McLeod date format", () => {
  assert.equal(extraPay.dallasExtraPayDate(new Date("2026-11-17T02:00:00Z")), "20261116000000-0600");
  assert.equal(extraPay.dallasExtraPayDate(new Date("2026-07-01T06:00:00Z")), "20260701000000-0500");
});


test("unassign restores and reads back the imported BLNUM without writing other order fields", async () => {
  const { calls, writes, prepareBlnumReset } = loadCase({ blnums: ["MARK", "MARK", "FILE-1"] });
  const reset = await prepareBlnumReset();
  await reset();
  assert.deepEqual(calls, ["/orders/0830846", "/orders/0830846", "/orders/updateRow", "/orders/0830846"]);
  assert.deepEqual(writes, [{ __type: "orders", company_id: "TMS", id: "0830846", blnum: "FILE-1" }]);
});

test("BLNUM restoration skips the original value and guards against a concurrent edit", async () => {
  const original = loadCase({ blnums: ["FILE-1"] });
  await (await original.prepareBlnumReset())();
  assert.deepEqual(original.writes, []);
  const changed = loadCase({ blnums: ["MARK", "NEW-MARK"] });
  await assert.rejects(await changed.prepareBlnumReset(), /BLNUM changed/);
  assert.deepEqual(changed.writes, []);
});

test("BLNUM restoration must verify the read-back", async () => {
  const { prepareBlnumReset } = loadCase();
  await assert.rejects(await prepareBlnumReset(), /did not verify the original BLNUM/);
});


test("unassign clears the McLeod container reference even when BLNUM is already original", async () => {
  const { writes, prepareBlnumReset } = loadCase({ blnums: ["FILE-1"], containers: ["ABCD1234567", "ABCD1234567", ""] });
  await (await prepareBlnumReset())();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].consignee_refno, "");
});
