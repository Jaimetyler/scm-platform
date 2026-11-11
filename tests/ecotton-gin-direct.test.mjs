import assert from "node:assert/strict";
import test from "node:test";
import { ginDirectProfile, parseGinDirectInvoices } from "../lib/ecotton/gin-direct.ts";
import { buildPayload } from "../lib/ecotton/mcleod.ts";

const invoicePage = (reference) => `
Service Invoice
SAV-Supply Chain Management Warehouse ID: 266861
1601 Old Augusta Road S Invoice #: ${reference}
Rincon, GA 31326 Invoice Date: 03/15/2026

Bill To:
Olam Cotton-Account of Bearer
Example City, GA 30000
Tariff ID Description Quantity Rate Total
001 receiving 100 3.00 300.00
002 shipping 100 4.00 400.00
003 COMPRESSION 100 0.00 0.00
006 Standard storage 1,500 0.12 180.00
Total Invoice Amount $880.00
`;
const tariffs = [1, 2, 3, 6].map((id) => ({
  tariff_id: id, mcleod_code: `TEST${id}`, active: true,
}));

test("each Gin Direct page produces its own standard eCotton payload", () => {
  const pages = [invoicePage("41"), invoicePage("42")];
  const profile = ginDirectProfile(pages);
  const invoices = parseGinDirectInvoices(pages, tariffs);
  assert.deepEqual(invoices.map((invoice) => invoice.reference), ["41", "42"]);
  const payload = buildPayload(invoices[0], profile);
  assert.equal(payload.blnum, "41");
  assert.equal(payload.consignee_refno, "20260315");
  assert.equal(payload.customer_id, "OLAMRIT1");
  assert.equal(payload.ordered_by, "GIN DIRECT");
  assert.equal(payload.order_type_id, "ECOTTON");
  assert.equal(payload.planning_comment, "880.00");
  assert.deepEqual(payload.stops.map((stop) => stop.location_id), ["SAVWHSE", "SAVWHSE"]);
  assert.equal(payload.movements[0].override_payee_id, "SCMIRIGA");
  assert.equal(payload.movements[0].override_pay_amt, 0);
  assert.deepEqual(payload.otherCharges.map((charge) => [charge.charge_id, charge.amount]), [
    ["TEST1", 300], ["TEST2", 400], ["TEST3", 0], ["TEST6", 180],
  ]);
});

test("Gin Direct blocks mismatched warehouse, unmapped tariff, duplicate number, and bad OCR totals", () => {
  const page = invoicePage("41");
  assert.throws(() => ginDirectProfile([page.replace("266861", "999999")]), /no confirmed Gin Direct location/);
  assert.throws(() => ginDirectProfile([page.replace("1601", "1607")]), /no confirmed Gin Direct location/);
  assert.throws(() => parseGinDirectInvoices([page], tariffs.slice(0, 3)), /Unmapped tariff 006/);
  assert.throws(() => parseGinDirectInvoices([page, page], tariffs), /Duplicate invoice number 41/);
  assert.throws(() => parseGinDirectInvoices([page.replace("1,500", "1,501")], tariffs), /Quantity × rate/);
  assert.throws(() => parseGinDirectInvoices([page.replace("880.00", "880.01")], tariffs), /printed invoice total/);
});

test("unmapped zero-dollar lines appear in review without posting a charge", () => {
  const [invoice] = parseGinDirectInvoices([invoicePage("41")], tariffs.filter((t) => t.tariff_id !== 3));
  assert.deepEqual(invoice.unpostedZeroTariffs, [{ tariffId: "003", description: "COMPRESSION", units: 100 }]);
  assert.equal(invoice.charges.length, 3);
  assert.equal(invoice.cents, 88000);
});

test("the Nutrien Account of Bearer uses the eCotton billing customer", () => {
  const page = invoicePage("41").replace("Olam Cotton", "Nutrien Ag Solutions");
  const [invoice] = parseGinDirectInvoices([page], tariffs);
  assert.equal(invoice.customerId, "NUTRSTG1");
});
