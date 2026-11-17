import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { outboundSteamshipLine } from "../lib/warehouse/outbound/booking-identifiers.ts";
import { formatBookingDate } from "../lib/warehouse/outbound/details.ts";

const require = createRequire(import.meta.url);
const { outputText } = ts.transpileModule(readFileSync("components/warehouse/HoustonBookingForms.tsx", "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
});
const exports = {};
new Function("require", "exports", outputText)(name => {
  if (name === "@/lib/warehouse/outbound/details") return { formatBookingDate };
  if (name === "@/lib/warehouse/outbound/booking-identifiers") return { outboundSteamshipLine };
  return require(name);
}, exports);

const booking = {
  booking_number: "NAM1234", customer: "Cotton Shipper", planned_containers: 41,
  steamship_line: "CMACGM", vessel: "EXAMPLE VESSEL / 123W", return_location: "HOUSTON BAYPORT",
  cutoff: "2026-11-20T16:00:00", cutoff_has_time: true, scm_file_number: "12345",
};
const lines = [
  { id: "active", line_status: "active", mark: "ACTIVE001", requested_bales: 90 },
  { id: "unassigned", line_status: "active", mark: "ACTIVE002", requested_bales: 89 },
  { id: "hold", line_status: "on_hold", mark: "ONHOLD001", requested_bales: 80 },
  { id: "cancelled", line_status: "cancelled", mark: "REMOVED001", requested_bales: 80 },
];
const containers = [
  { booking_line_id: "active", split_transfer_id: "transfer", container_number: "MOVED1234567" },
  { booking_line_id: "active", container_number: "TEST1234567", seal_number: "UL-123", carrier_name: "Outside Carrier" },
];
const render = (manifest, overrides = {}) => renderToStaticMarkup(React.createElement(exports.default, {
  booking, lines, containers, manifest, date: "Nov 17, 2026", ...overrides,
}));

test("empty request uses the planned count and carries numbering across sheets", () => {
  const form = render(false);
  assert.equal((form.match(/<article/g) ?? []).length, 2);
  assert.equal((form.match(/<li>/g) ?? []).length, 41);
  assert.match(form, /<ol class="hou-form-slots" start="21">/);
  assert.match(form, /<li>41\.<\/li>/);
  assert.match(form, /<strong>LINE<\/strong><span>CMA/);
  assert.match(form, /<strong>CUT OFF<\/strong><span>Nov 20, 2026, 4:00 PM/);
  assert.doesNotMatch(form, /TEST1234567/);
});

test("eight empties print as one sequential list with eight writing lines", () => {
  const form = render(false, { booking: { ...booking, planned_containers: 8 } });
  assert.equal((form.match(/<ol/g) ?? []).length, 1);
  assert.deepEqual(Array.from(form.matchAll(/<li>(\d+)\.<\/li>/g), entry => Number(entry[1])),
    [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("manifest prints active marks in one document and uses only their current equipment", () => {
  const form = render(true);
  assert.equal((form.match(/<article/g) ?? []).length, 2);
  assert.match(form, /ACTIVE001.*ACTIVE002/);
  assert.match(form, /<strong>FILE #<\/strong><span>12345/);
  assert.match(form, /<strong>VG #<\/strong><span>123W/);
  assert.match(form, /<strong>TRUCK COMPANY<\/strong><span><\/span>/);
  assert.doesNotMatch(form, /SCM INTERMODAL/);
  assert.match(form, /TEST1234567.*UL-123.*Outside Carrier/);
  assert.doesNotMatch(form, /ONHOLD001|REMOVED001|MOVED1234567/);
  assert.match(render(true, { lines: [] }), /no active marks/);
});
