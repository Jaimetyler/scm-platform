import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url),
  cache = new Map();
function load(file) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path).exports;
  const mod = { exports: {} };
  cache.set(path, mod);
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const local = (name) =>
    name.startsWith(".") ? load(resolve(dirname(path), name)) : require(name);
  new Function("require", "module", "exports", source)(local, mod, mod.exports);
  return mod.exports;
}
const { PROFILES, CUSTOMER_ALIASES, money, invoiceDate } = load(
  "lib/ecotton/model.ts",
);
const { parseInvoices } = load("lib/ecotton/parse.ts");
const {
  buildPayload,
  dateStamp,
  findDuplicates,
  verifyRatedOrder,
  movementDefaultsUpdate,
} = load("lib/ecotton/mcleod.ts");
const { processInvoice, reconcileInvoice } = load("lib/ecotton/engine.ts");
const profile = PROFILES[0];
const summary =
  "Supply Chain Management HOU (SCM),,,,,,,,,\nBilling Summary,,,,,,,,,\n,,Marks,Invoice date,Shipper ID,Name,,Orders,,Charges\n,,SYN-MARK,10/20/2026,SYN-SHIP,ECOM USA LLC,SYN-BOL,,12.34,\n,,,,,,,,,12.34";
const detail =
  "Supply Chain Management HOU (SCM),,,,,\nBilling Report Detail to Export,,,,,\n,,Shipping Order #,Description,Quantity,TotalCharges\n,,SYN-BOL,Standard storage,2,10.00\n,,SYN-BOL,Standard storage,1,3.34\n,,SYN-BOL,Standard Storage Credit,1,-1.00\n,,SYN-BOL,,,12.34\n,,,,,12.34";
const descriptions = [
    { normalized_description: "STANDARD STORAGE", tariff_id: 6, active: true },
    {
      normalized_description: "STANDARD STORAGE CREDIT",
      tariff_id: 106,
      active: true,
    },
  ],
  tariffs = [
    { tariff_id: 6, mcleod_code: "HCS", active: true },
    { tariff_id: 106, mcleod_code: "HC36", active: true },
  ];
const invoice = () =>
  parseInvoices(summary, detail, profile, descriptions, tariffs)[0];
function actual(i = invoice(), p = profile) {
  return { ...buildPayload(i, p), id: "SYN1", total_charge: i.cents / 100 };
}
function harness(options = {}) {
  let current = {
    id: "row",
    status: "ready",
    order_id: null,
    invoice: invoice(),
    profile,
    version: 0,
  };
  const events = [],
    writes = [];
  let order = null;
  const store = {
    claim: async (id, from, to) => {
      if (current.status !== from) return null;
      current = { ...current, status: to, version: current.version + 1 };
      return { ...current };
    },
    finish: async (row, state, id, note) => {
      if (options.failReceipt && state === "created")
        throw Error("DB receipt failed");
      assert.equal(row.version, current.version);
      current = {
        ...current,
        status: state,
        order_id: id ?? current.order_id,
        version: current.version + 1,
      };
      Object.assign(row, current);
      events.push({ state, note });
    },
  };
  const vendor = {
    read: async (path) => {
      if (options.readFailure) throw Error("GET failed");
      if (path.includes("/search?")) return options.candidates || [];
      return order || options.order || actual();
    },
    write: async (path, payload) => {
      writes.push(path);
      if (options.createTimeout && path === "/orders/create")
        throw Error("timeout");
      if (options.rateTimeout && path.includes("/autorate/"))
        throw Error("timeout");
      if (path === "/orders/create") {
        order = { ...payload, id: "SYN1", total_charge: 0 };
        if (options.missingMovementDefaults)
          order.movements = [{ id: "M1", status: "A", company_id: "TMS" }];
        return options.missingId ? {} : { id: "SYN1" };
      }
      if (path === "/movement/update") {
        if (options.setupTimeout) throw Error("setup timeout");
        order = {
          ...order,
          movements: [{ ...order.movements[0], ...payload }],
        };
        return order;
      }
      if (path.startsWith("/carrierDispatch/setPay/")) {
        if (options.payTimeout) throw Error("setPay timeout");
        order.movements[0].override_pay_rate = 0;
        return { raw: "success" };
      }
      order.total_charge = current.invoice.cents / 100;
      return order;
    },
  };
  return {
    store,
    vendor,
    writes,
    events,
    row: () => ({ ...current }),
    set(row) {
      current = { ...current, ...row };
    },
  };
}
test("original reports retain columns, preserve repeated storage and per-order total", () => {
  const i = invoice();
  assert.equal(i.reference, "SYN-BOL");
  assert.equal(i.mark, "SYN-MARK");
  assert.equal(i.customerId, "ECOMDAT1");
  assert.equal(i.cents, 1234);
  assert.equal(i.charges.length, 3);
  assert.equal(i.charges[2].cents, -100);
});
test("source inconsistencies and unknown mappings block the entire preview", () => {
  for (const [s, d, ds] of [
    [summary.replace("ECOM USA LLC", "Unknown Customer"), detail, descriptions],
    [
      summary,
      detail.replace("SYN-BOL,Standard storage", "OTHER,Standard storage"),
      descriptions,
    ],
    [summary.replace(",,12.34,", ",,13.34,"), detail, descriptions],
    [summary, detail, []],
    [summary.replace("10/20/2026", "2/30/2026"), detail, descriptions],
    [
      summary.replace(",,,,,,,,,12.34", ""),
      detail.replace(",,,,,12.34", ""),
      descriptions,
    ],
  ]) {
    assert.throws(() => parseInvoices(s, d, profile, ds, tariffs));
  }
  const row = summary.split("\n")[3];
  assert.throws(
    () =>
      parseInvoices(
        summary.replace(row, row + "\n" + row),
        detail,
        profile,
        descriptions,
        tariffs,
      ),
    /Duplicate/,
  );
});
test("explicit customer aliases normalize NBSP and whitespace without fuzzy guessing", () => {
  assert.equal(CUSTOMER_ALIASES.get("BUNGE USA AGRICULTURE LLC"), "BUNGECNE");
  assert.equal(money("1,234.50"), 123450);
  assert.throws(() => money("12x"));
  assert.throws(() => invoiceDate("2/29/2026"));
});
test("payload defaults and warehouse DST use invoice date; planning comment is order total", () => {
  const p = buildPayload(invoice(), profile);
  assert.equal(p.planning_comment, "12.34");
  assert.equal(p.movements[0].override_payee_id, "SCMIRIGA");
  assert.equal(p.stops[0].sched_arrive_early, "20261020000000-0400");
  assert.equal(
    dateStamp("2026-01-10", "America/Chicago"),
    "20260110000000-0600",
  );
  assert.throws(
    () => buildPayload(invoice(), { ...profile, confirmed: false }),
    /confirmed/,
  );
  assert.equal(verifyRatedOrder(actual(), invoice(), profile).length, 0);
  const extra = actual();
  extra.otherCharges.push(extra.otherCharges[0]);
  assert.ok(verifyRatedOrder(extra, invoice(), profile).length);
});
test("duplicate lookup deduplicates IDs, checks exact reference and warehouse; malformed/incomplete search blocks", async () => {
  const i = invoice(),
    a = actual();
  assert.deepEqual(await findDuplicates(async () => null, i, profile), []);
  const found = await findDuplicates(
    async (p) =>
      p.includes("/search?") ? [{ id: "SYN1" }, { id: "SYN1" }] : a,
    i,
    profile,
  );
  assert.equal(found.length, 1);
  const wrong = actual();
  wrong.blnum = "SYN-BOL-OTHER";
  assert.equal(
    (
      await findDuplicates(
        async (p) => (p.includes("/search?") ? [{ id: "SYN1" }] : wrong),
        i,
        profile,
      )
    ).length,
    0,
  );
  await assert.rejects(
    findDuplicates(async () => ({ unknown: [] }), i, profile),
  );
  await assert.rejects(
    findDuplicates(
      async (p) =>
        p.includes("/search?")
          ? Array.from({ length: 5 }, (_, i) => ({ id: "SYN" + i }))
          : { ...a, id: p.split("/").at(-1) },
      i,
      profile,
    ),
    /pagination/,
  );
});
test("successful create/rate uses persisted IDs and never delivers", async () => {
  const h = harness();
  await processInvoice(h.row(), h.store, h.vendor);
  assert.equal(h.row().status, "verified");
  assert.deepEqual(h.writes, ["/orders/create", "/orders/autorate/SYN1"]);
  await processInvoice(h.row(), h.store, h.vendor);
  assert.equal(h.writes.length, 2);
});
test("simultaneous submissions only send one create and one autorate", async () => {
  const h = harness();
  await Promise.allSettled([
    processInvoice(h.row(), h.store, h.vendor),
    processInvoice(h.row(), h.store, h.vendor),
  ]);
  assert.equal(h.writes.filter((p) => p === "/orders/create").length, 1);
  assert.equal(h.writes.filter((p) => p.includes("autorate")).length, 1);
});
test("lookup failure before write returns ready; existing complete order is adopted without writes", async () => {
  const h = harness({ readFailure: true });
  await assert.rejects(processInvoice(h.row(), h.store, h.vendor));
  assert.equal(h.row().status, "ready");
  assert.equal(h.writes.length, 0);
  const existing = harness({ candidates: [{ id: "SYN1" }], order: actual() });
  await processInvoice(existing.row(), existing.store, existing.vendor);
  assert.equal(existing.row().status, "verified");
  assert.equal(existing.writes.length, 0);
});
test("create timeout and missing ID remain fenced; rerun never retries", async () => {
  for (const options of [{ createTimeout: true }, { missingId: true }]) {
    const h = harness(options);
    await processInvoice(h.row(), h.store, h.vendor).catch(() => {});
    assert.equal(h.row().status, "creation_uncertain");
    await assert.rejects(
      processInvoice(h.row(), h.store, h.vendor),
      /uncertain/,
    );
    assert.equal(h.writes.length, 1);
  }
});
test("failed DB receipt and autorate timeout preserve fences", async () => {
  const h = harness({ failReceipt: true });
  await assert.rejects(processInvoice(h.row(), h.store, h.vendor));
  assert.equal(h.row().status, "creating");
  assert.equal(h.writes.length, 1);
  const rate = harness({ rateTimeout: true });
  await assert.rejects(processInvoice(rate.row(), rate.store, rate.vendor));
  assert.equal(rate.row().status, "rating_uncertain");
  await assert.rejects(processInvoice(rate.row(), rate.store, rate.vendor));
  assert.equal(rate.writes.length, 2);
});
test("read-only reconciliation never clears a no-match fence or writes", async () => {
  const h = harness();
  h.set({ status: "creation_uncertain" });
  await assert.rejects(reconcileInvoice(h.row(), h.store, h.vendor), /fence/);
  assert.equal(h.row().status, "creation_uncertain");
  assert.equal(h.writes.length, 0);
  const good = harness({ candidates: [{ id: "SYN1" }], order: actual() });
  good.set({ status: "creation_uncertain" });
  await reconcileInvoice(good.row(), good.store, good.vendor);
  assert.equal(good.row().status, "verified");
  assert.equal(good.writes.length, 0);
});
test("database ledger deduplicates reuploads, marks source conflicts, CAS claims, and protects private data", async () => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;",
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261027190536_ecotton_import_ledger.sql",
      "utf8",
    ),
  );
  const prepare = async (digest, sourceHash) => {
    const p = [
      {
        invoice: invoice(),
        source_hash: sourceHash,
        status: "ready",
        note: "test",
      },
    ];
    return (
      await db.query("select prepare_ecotton_import($1,$2,$3,$4) as id", [
        digest,
        JSON.stringify(profile),
        JSON.stringify(p),
        "synthetic-admin",
      ])
    ).rows[0].id;
  };
  const run = await prepare("a".repeat(64), "source");
  assert.equal(await prepare("a".repeat(64), "source"), run);
  const run2 = await prepare("b".repeat(64), "different");
  assert.equal(
    (
      await db.query(
        "select conflict from ecotton_import_items where run_id=$1",
        [run2],
      )
    ).rows[0].conflict,
    true,
  );
  const row = (await db.query("select * from ecotton_import_orders")).rows[0];
  const claim = () =>
    db.query(
      "select * from transition_ecotton_import($1,0,'ready','creating',null,'claim','admin')",
      [row.id],
    );
  const claims = await Promise.all([claim(), claim()]);
  assert.equal(
    claims.reduce((n, r) => n + r.rows.length, 0),
    1,
  );
  await assert.rejects(
    db.query(
      "select * from transition_ecotton_import($1,1,'creating','rating',null,'illegal','admin')",
      [row.id],
    ),
    /Invalid import state/,
  );
  const perms = (
    await db.query(
      "select has_table_privilege('anon','ecotton_import_orders','select') as a,has_table_privilege('authenticated','ecotton_import_orders','select') as b,has_function_privilege('anon','prepare_ecotton_import(text,jsonb,jsonb,text)','execute') as f",
    )
  ).rows[0];
  assert.deepEqual(perms, { a: false, b: false, f: false });
  assert.equal(
    (await db.query("select count(*)::int as n from ecotton_import_events"))
      .rows[0].n >= 2,
    true,
  );
  await db.close();
});
test("database source claims span different run digests and uncertainty has no automatic reset", async () => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;",
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261027190536_ecotton_import_ledger.sql",
      "utf8",
    ),
  );
  const rows = JSON.stringify([
    { invoice: invoice(), source_hash: "same", status: "ready", note: "test" },
  ]);
  const p = (d) =>
    db.query("select prepare_ecotton_import($1,$2,$3,$4) as id", [
      d.repeat(64),
      JSON.stringify(profile),
      rows,
      "admin",
    ]);
  await p("a");
  await p("b");
  assert.equal(
    (await db.query("select count(*)::int as n from ecotton_import_orders"))
      .rows[0].n,
    1,
  );
  const id = (await db.query("select id from ecotton_import_orders")).rows[0]
    .id;
  await db.query(
    "select * from transition_ecotton_import($1,0,'ready','creating',null,'claim','admin')",
    [id],
  );
  await db.query(
    "select * from transition_ecotton_import($1,1,'creating','creation_uncertain',null,'timeout','admin')",
    [id],
  );
  await assert.rejects(
    db.query(
      "select * from transition_ecotton_import($1,2,'creation_uncertain','ready',null,'retry','admin')",
      [id],
    ),
    /Invalid/,
  );
  await db.exec("set role service_role");
  await assert.rejects(
    db.query("delete from ecotton_import_events"),
    /permission/,
  );
  await db.exec("reset role");
  await db.close();
});
test("shared parser/payload supports every configured terminal with explicit warehouse separation", () => {
  for (const p of PROFILES) {
    const heading =
      p.terminal === "HOU"
        ? "Supply Chain Management HOU (SCM)"
        : p.terminal === "DAL"
          ? p.location === "SCMDDATX"
            ? "Supply Chain - Dallas 2 (843001)"
            : "Supply Chain Management Dallas (875260)"
          : "Supply Chain Management Savannah";
    const replace = (s) =>
      s.replace("Supply Chain Management HOU (SCM)", heading);
    const parsed = parseInvoices(
      replace(summary),
      replace(detail),
      p,
      descriptions,
      tariffs,
    );
    const payload = buildPayload(parsed[0], p);
    assert.equal(payload.revenue_code_id, p.revenue);
    assert.equal(payload.stops[0].location_id, p.location);
    assert.equal(payload.stops[1].location_id, p.location);
    assert.equal(payload.status, "A");
  }
  const dal = PROFILES.find((p) => p.location === "SCMDDETX");
  const two = (s) =>
    s.replace(
      "Supply Chain Management HOU (SCM)",
      "Supply Chain - Dallas 2 (843001)",
    );
  assert.throws(
    () => parseInvoices(two(summary), two(detail), dal, descriptions, tariffs),
    /Dallas report/,
  );
});

test("read-back detects changed payee, nonzero pay and unexpected linehaul defaults", () => {
  for (const change of [
    (o) => (o.movements[0].override_pay_amt = 20),
    (o) => (o.movements[0].override_payee_id = "OTHER"),
    (o) => (o.rate = 1),
    (o) => (o.rate = null),
    (o) => (o.movements[0].override_pay_amt = null),
    (o) => (o.collection_method = "P"),
  ]) {
    const o = actual();
    change(o);
    assert.ok(verifyRatedOrder(o, invoice(), profile).length);
  }
});

test("live create shape with missing movement overrides is configured once before autorate", async () => {
  const h = harness({ missingMovementDefaults: true });
  await processInvoice(h.row(), h.store, h.vendor);
  assert.equal(h.row().status, "verified");
  assert.deepEqual(h.writes, [
    "/orders/create",
    "/movement/update",
    "/carrierDispatch/setPay/M1?method=F&units=1&rate=0&carrierPay=0",
    "/orders/autorate/SYN1",
  ]);
});
test("uncertain movement update stays fenced and cannot be retried", async () => {
  const h = harness({ missingMovementDefaults: true, setupTimeout: true });
  await assert.rejects(processInvoice(h.row(), h.store, h.vendor));
  assert.equal(h.row().status, "rating_uncertain");
  await assert.rejects(processInvoice(h.row(), h.store, h.vendor));
  assert.deepEqual(h.writes, ["/orders/create", "/movement/update"]);
});
test("movement setup preserves other data and refuses other carriers, payments or actuals", () => {
  const before = actual();
  before.movements = [{ id: "M1", status: "A" }];
  const fixed = movementDefaultsUpdate(before, invoice(), profile, "SYN1");
  assert.equal(fixed.movements[0].override_payee_id, "SCMIRIGA");
  assert.deepEqual(fixed.stops, before.stops);
  assert.deepEqual(fixed.otherCharges, before.otherCharges);
  assert.equal(before.movements[0].override_payee_id, undefined);
  for (const change of [
    (o) => (o.movements[0].override_pay_amt = 10),
    (o) => (o.movements[0].override_payee_id = "OTHER"),
    (o) => (o.stops[0].actual_arrival = "20261020"),
  ]) {
    const o = structuredClone(before);
    change(o);
    assert.throws(() => movementDefaultsUpdate(o, invoice(), profile, "SYN1"));
  }
});

test("fixed pay requires explicit zero in both rate fields and amount", () => {
  const o = actual();
  delete o.movements[0].override_pay_rate;
  assert.ok(verifyRatedOrder(o, invoice(), profile).length);
  delete o.movements[0].override_paye_rate;
  assert.ok(verifyRatedOrder(o, invoice(), profile).length);
});
test("a nonzero supplemental rate remains a payment verification failure", () => {
  const o = actual();
  o.movements[0].override_pay_rate = 5;
  assert.ok(verifyRatedOrder(o, invoice(), profile).length);
});

test("a carrier-pay response timeout stays fenced before autorate", async () => {
  const h = harness({ missingMovementDefaults: true, payTimeout: true });
  await assert.rejects(processInvoice(h.row(), h.store, h.vendor));
  assert.equal(h.row().status, "rating_uncertain");
  await assert.rejects(processInvoice(h.row(), h.store, h.vendor));
  assert.equal(h.writes.filter((p) => p.includes("setPay")).length, 1);
  assert.equal(h.writes.filter((p) => p.includes("autorate")).length, 0);
});
