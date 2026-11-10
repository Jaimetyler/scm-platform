import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReference, referenceMatchesInput } from "../lib/inbound/checkin/reference-match.ts";

test("both complete references in the observed BLNUM match the same field", () => {
  for (const input of ["2951", "4500281026", "2951 / 4500281026"]) {
    assert.equal(referenceMatchesInput("2951 / 4500281026", input), true, input);
  }
});

test("all slash-spacing variants normalize both stored and entered references", () => {
  const variants = ["81382 / 49001932", "81382/ 49001932", "81382 /49001932", "81382/49001932"];
  for (const value of variants) for (const input of [...variants, "81382", "49001932"]) {
    assert.equal(referenceMatchesInput(value, input), true, `${JSON.stringify(value)} / ${JSON.stringify(input)}`);
  }
  assert.equal(normalizeReference("  ab-008 /\u00a0 cd-009  "), "AB-008/CD-009");
  assert.equal(normalizeReference(" ab  008 - cd009 "), "AB  008 - CD009", "Only slash-adjacent whitespace changes");
});

test("normalized compounds require the same ordered reference context", () => {
  for (const value of ["81382", "49001932", "81382 / WRONG", "WRONG / 49001932", "49001932 / 81382",
    "81382 / OTHER / 49001932", "81382 OTHER 49001932", "181382 / 49001932", "81382 / 490019320"])
    assert.equal(referenceMatchesInput(value, "81382/49001932"), false, value);
  for (const input of ["81382 / WRONG", "WRONG / 49001932", "081382 / 49001932", "81382 / 049001932"])
    assert.equal(referenceMatchesInput("81382 / 49001932", input), false, input);
  assert.equal(referenceMatchesInput("OTHER / 81382 / 49001932 / LAST", "81382/49001932"), true);
});

test("whole inputs require field edges or whitespace, slash, and hyphen boundaries", () => {
  for (const value of ["2951", "2951 4500281026", "4500281026\t2951\nOTHER", "2951/4500281026",
    "4500281026/2951", "2951-4500281026", "4500281026-2951", "LOAD-2951/OTHER"]) {
    assert.equal(referenceMatchesInput(value, "2951"), true, value);
  }
  for (const value of ["129510", "12951", "29510", "A2951", "2951B", "(2951)", "REF_2951", "REF,2951", "2951.REF"]) {
    assert.equal(referenceMatchesInput(value, "2951"), false, value);
  }
});

test("exact hyphenated and alphanumeric inputs retain trim and case normalization", () => {
  for (const input of ["SCM-ABC", " ab12-cd34 ", "ref_2951", "REF.2951", "2951 / 4500281026"]) {
    assert.equal(referenceMatchesInput(`  ${input.toLowerCase().trim()}  `, input), true, input);
  }
  assert.equal(referenceMatchesInput("LOAD AB12-CD34 / EXTRA", "ab12-cd34"), true);
  assert.equal(referenceMatchesInput("AB12-X-CD34", "AB12-CD34"), false);
  assert.equal(referenceMatchesInput("AB12-CD340", "AB12-CD34"), false);
});

test("common Unicode whitespace is a delimiter without rewriting the input", () => {
  for (const separator of ["\u00a0", "\u2003", "\u2009", "\u202f", "\u3000", "\u2028", "\u2029", "\ufeff"]) {
    assert.equal(referenceMatchesInput(`OTHER${separator}2951${separator}FINAL`, "2951"), true, JSON.stringify(separator));
  }
  assert.equal(referenceMatchesInput("2951\u00a04500281026", "2951 4500281026"), false);
});

test("leading zeroes are significant and input is never split into alternatives", () => {
  assert.equal(referenceMatchesInput("002951 / 04500281026", "002951"), true);
  assert.equal(referenceMatchesInput("002951 / 04500281026", "2951"), false);
  assert.equal(referenceMatchesInput("2951 / 4500281026", "002951"), false);
  for (const input of ["2951 / WRONG", "2951 4500281026", "2951-4500281026", "2951 9999"]) {
    assert.equal(referenceMatchesInput("2951 / 4500281026", input), false, input);
  }
  assert.equal(referenceMatchesInput("002951 / 04500281026", "002951/04500281026"), true);
  assert.equal(referenceMatchesInput("ABC-0012 / REF-0009", "abc-0012/ref-0009"), true);
  assert.equal(referenceMatchesInput("ABC-X-0012 / REF-0009", "ABC-0012/REF-0009"), false);
  assert.equal(referenceMatchesInput("ABC-00120 / REF-0009", "ABC-0012/REF-0009"), false);
});

test("an earlier partial occurrence cannot hide a later whole input", () => {
  assert.equal(referenceMatchesInput("129510 / 2951", "2951"), true);
  assert.equal(referenceMatchesInput("29510 / 2951X", "2951"), false);
});

test("missing and blank references never match", () => {
  for (const value of [undefined, null, "", " "]) {
    assert.equal(referenceMatchesInput(value, "2951"), false);
    assert.equal(referenceMatchesInput("2951", value), false);
    assert.equal(referenceMatchesInput(value, value), false);
  }
});
