import test from "node:test";
import assert from "node:assert/strict";
import { getOrderDispatcher } from "../lib/inbound/checkin/dispatcher.ts";

test("uses the movement dispatcher name when the user IDs match", () => {
  assert.deepEqual(getOrderDispatcher({
    movements: [{ dispatcher_user_id: "dispatcher1" }],
    operationsUser: { id: "dispatcher1", name: "Alex Smith" },
  }), { id: "dispatcher1", name: "Alex Smith" });
});

test("does not present an unrelated order user as the dispatcher", () => {
  assert.deepEqual(getOrderDispatcher({
    movements: [{ dispatcher_user_id: "dispatcher1" }],
    operationsUser: { id: "different", name: "Other Person" },
  }), { id: "dispatcher1", name: null });
});
