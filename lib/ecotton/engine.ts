import {
  buildPayload,
  findDuplicates,
  identityMatches,
  verifyRatedOrder,
  movementUpdatePayload,
} from "./mcleod.ts";
import type { Invoice, Profile } from "./model.ts";
export type Ledger = {
  id: string;
  status: string;
  order_id: string | null;
  invoice: Invoice;
  profile: Profile;
};
export type Store = {
  claim: (id: string, from: string, to: string) => Promise<Ledger | null>;
  finish: (
    row: Ledger,
    state: string,
    orderId: string | null,
    note: string,
  ) => Promise<void>;
};
export type Vendor = {
  read: (path: string) => Promise<any>;
  write: (path: string, payload?: any) => Promise<any>;
};
/** No retries after a vendor write. A failed receipt leaves the persisted claim fenced. */
export async function processInvoice(
  row: Ledger,
  store: Store,
  vendor: Vendor,
) {
  let held: Ledger | null = null;
  if (
    ["creating", "creation_uncertain", "rating", "rating_uncertain"].includes(
      row.status,
    )
  )
    throw new Error(
      "An earlier write is uncertain. Use read-only reconciliation.",
    );
  if (row.status === "verified") return;
  if (row.status === "ready") {
    held = await store.claim(row.id, "ready", "creating");
    if (!held) throw new Error("This order was claimed by another request.");
    row = held;
    let candidates: any[];
    try {
      candidates = await findDuplicates(vendor.read, row.invoice, row.profile);
    } catch (e) {
      await store.finish(
        row,
        "ready",
        null,
        "Duplicate lookup failed before any write: " + (e as Error).message,
      );
      throw e;
    }
    if (candidates.length) {
      if (
        candidates.length !== 1 ||
        !identityMatches(candidates[0], row.invoice, row.profile)
      ) {
        await store.finish(
          row,
          "blocked",
          null,
          "Existing reference conflicts with source.",
        );
        return;
      }
      const errors = verifyRatedOrder(candidates[0], row.invoice, row.profile);
      // Never adopt and mutate an existing order automatically, even if its identity matches.
      await store.finish(
        row,
        errors.length ? "blocked" : "verified",
        candidates[0].id,
        errors.length
          ? "Existing order requires charge review: " + errors.join("; ")
          : "Existing order already matches invoice; no writes.",
      );
      return;
    }
    let created: any;
    try {
      created = await vendor.write(
        "/orders/create",
        buildPayload(row.invoice, row.profile),
      );
    } catch (e) {
      await store.finish(
        row,
        "creation_uncertain",
        null,
        "Create response uncertain; do not retry.",
      );
      throw e;
    }
    const id = String(created?.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) {
      await store.finish(
        row,
        "creation_uncertain",
        null,
        "Create returned no verified order ID; do not retry.",
      );
      return;
    }
    await store.finish(row, "created", id, "McLeod returned order ID.");
    row = { ...row, status: "created", order_id: id };
  }
  if (row.status === "created") {
    if (!row.order_id) throw new Error("Missing saved McLeod order ID.");
    const claimed = await store.claim(row.id, "created", "rating");
    if (!claimed) throw new Error("This order was claimed by another request.");
    row = claimed;
    let before: any;
    try {
      before = await vendor.read("/orders/" + encodeURIComponent(row.order_id));
    } catch (e) {
      await store.finish(
        row,
        "created",
        row.order_id,
        "Read failed before any movement/rate write.",
      );
      throw e;
    }
    let errors = verifyRatedOrder(before, row.invoice, row.profile);
    if (
      errors.includes(
        "Movement payee or zero-payment settings differ from approved profile",
      )
    ) {
      let update: any;
      try {
        update = movementUpdatePayload(
          before,
          row.invoice,
          row.profile,
          row.order_id,
        );
      } catch (e) {
        await store.finish(row, "blocked", row.order_id, (e as Error).message);
        return;
      }
      // The persisted rating claim fences BOTH setup and autorate. Never reset it
      // to created after a movement write or an uncertain verification response.
      try {
        await vendor.write("/movement/update", update);
        await vendor.write(
          "/carrierDispatch/setPay/" +
            encodeURIComponent(update.id) +
            "?method=F&units=1&rate=0&carrierPay=0",
        );
        before = await vendor.read(
          "/orders/" + encodeURIComponent(row.order_id),
        );
        errors = verifyRatedOrder(before, row.invoice, row.profile);
      } catch (e) {
        await store.finish(
          row,
          "rating_uncertain",
          row.order_id,
          "Movement setup or read-back uncertain; do not retry.",
        );
        throw e;
      }
    }
    if (String(before.id) !== row.order_id)
      errors.push("Returned order ID differs from saved creation receipt");
    if (
      String(before.status).toUpperCase() !== "A" ||
      !Array.isArray(before.stops) ||
      before.stops.some((s) => String(s.status).toUpperCase() !== "A")
    )
      errors.push("New order or stops are not Available; review before rating");
    const critical = errors.filter(
      (s) => s !== "McLeod order total differs from source invoice",
    );
    if (critical.length) {
      await store.finish(
        row,
        "blocked",
        row.order_id,
        "Created order failed verification: " + critical.join("; "),
      );
      return;
    }

    try {
      await vendor.write(
        "/orders/autorate/" + encodeURIComponent(row.order_id),
      );
      const after = await vendor.read(
        "/orders/" + encodeURIComponent(row.order_id),
      );
      const errors = verifyRatedOrder(after, row.invoice, row.profile);
      if (String(after.id) !== row.order_id)
        errors.push("Returned order ID differs from saved creation receipt");
      if (
        String(after.status).toUpperCase() !== "A" ||
        !Array.isArray(after.stops) ||
        after.stops.some((s) => String(s.status).toUpperCase() !== "A")
      )
        errors.push(
          "Rated order status requires review; delivery remains separate",
        );
      await store.finish(
        row,
        errors.length ? "blocked" : "verified",
        row.order_id,
        errors.length
          ? errors.join("; ")
          : "Created, rated and read-back verified; delivery not changed.",
      );
    } catch (e) {
      await store.finish(
        row,
        "rating_uncertain",
        row.order_id,
        "Autorate or verification uncertain; do not retry.",
      );
      throw e;
    }
  }
}
export async function reconcileInvoice(
  row: Ledger,
  store: Store,
  vendor: Vendor,
) {
  if (
    ![
      "creating",
      "creation_uncertain",
      "rating",
      "rating_uncertain",
      "blocked",
      "created",
    ].includes(row.status)
  )
    throw new Error("This row does not need reconciliation.");
  // This operation never clears a claim to ready. No match is not proof of a failed write.
  const candidates = row.order_id
    ? [await vendor.read("/orders/" + encodeURIComponent(row.order_id))]
    : await findDuplicates(vendor.read, row.invoice, row.profile);
  if (
    candidates.length !== 1 ||
    !identityMatches(candidates[0], row.invoice, row.profile)
  )
    throw new Error(
      "Could not establish one matching order. The write fence remains in place.",
    );
  if (row.order_id && String(candidates[0].id) !== row.order_id)
    throw new Error(
      "Saved McLeod ID could not be reconciled. The fence remains in place.",
    );
  const errors = verifyRatedOrder(candidates[0], row.invoice, row.profile);
  // A known creation receipt may resume rating only when all identity/charge checks pass.
  const state = errors.length ? "blocked" : "verified";
  await store.finish(
    row,
    state,
    candidates[0].id,
    errors.length
      ? "Read-only reconciliation: " + errors.join("; ")
      : "Read-only reconciliation verified existing order; no writes.",
  );
}
