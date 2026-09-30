import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseBungeBooking } from '../lib/warehouse/outbound/bunge.ts';

function request(footer) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Booking Request'], ['Bunge USA Agriculture LLC'], ['Booking #:', '', 'TEST-123'],
    ['Mark', 'Load By', 'Conf', 'S.O.', '', 'Warehouse', 'Bales'],
    ['MARK-A', '09/11/26', 'Y', 'SO-001', '266861', 'Supply Chain Management, LLC (SAV)', 90],
    ['Warehouse Contact Summary'], ['266861', 'Savannah 984'],
    ['Total Bales:', 90], ['Containers:', 1], ...footer,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('Bunge footer imports ERD, earlier/later cutoff dates and vessel despite shifted cells', () => {
  const booking = parseBungeBooking(request([
    ['ERD:', '', '', '9/11/2026'], ['C/O:', '', '9/16/2026'],
    ['Port Cut:', '', '', '09/18/2026'], ['Ramp Cut:', '09/18/2026'], ['Vessel/Voyage:', '', 'OOCL GUANGZHOU / 178 E'],
  ]));
  assert.equal(booking.erd, '2026-09-11');
  assert.equal(booking.docCutoff, '2026-09-16');
  assert.equal(booking.cutoff, '2026-09-18');
  assert.equal(booking.vessel, 'OOCL GUANGZHOU / 178 E');
  assert.equal(booking.lines.length, 1);
  assert.equal(booking.totalBales, 90);
  assert.deepEqual(booking.warnings, []);
});

test('differing port/ramp dates use earlier doc cutoff and expose every source date for review', () => {
  const booking = parseBungeBooking(request([['C/O:', '10/6/2026'], ['Port Cut:', '10/7/2026'], ['Ramp Cut:', '10/1/2026']]));
  assert.equal(booking.docCutoff, '2026-10-01');
  assert.equal(booking.cutoff, '2026-10-07');
  assert.equal(booking.sourceDates.length, 3);
  assert.ok(booking.detailNotes.some(note => note.includes('more than two')));
});

test('one cutoff date does not invent a document cutoff; absent details remain empty', () => {
  const one = parseBungeBooking(request([['Port Cut:', '10/7/2026'], ['Ramp Cut:', '10/7/2026']]));
  assert.equal(one.docCutoff, null);
  assert.equal(one.cutoff, '2026-10-07');
  const empty = parseBungeBooking(request([['ERD:', '', 'Notify Party:'], ['C/O:', '', 'BOL Date:'], ['Vessel/Voyage:']]));
  for (const field of ['erd', 'docCutoff', 'cutoff', 'vessel']) assert.equal(empty[field], null);
});

test('explicit document/cargo labels take precedence and retain AM/PM times', () => {
  const booking = parseBungeBooking(request([['Doc Cutoff:', '9/16/2026 4:00 PM'], ['Cutoff:', '2026/09/18 08:30'], ['C/O:', '9/15/2026']]));
  assert.equal(booking.docCutoff, '2026-09-16T16:00');
  assert.equal(booking.cutoff, '2026-09-18T08:30');
});

test('numeric Excel dates work and impossible dates fail instead of shifting silently', () => {
  const serial = (Date.UTC(2026, 8, 11) - Date.UTC(1899, 11, 30)) / 86400000;
  const booking = parseBungeBooking(request([['ERD:', serial], ['C/O:', serial + 0.5], ['Port Cut:', serial + 2 + 0.75]]));
  assert.equal(booking.erd, '2026-09-11');
  assert.equal(booking.docCutoff, '2026-09-11T12:00');
  assert.equal(booking.cutoff, '2026-09-13T18:00');
  assert.throws(() => parseBungeBooking(request([['ERD:', '02/30/2026']])), /Invalid ERD/);
  assert.throws(() => parseBungeBooking(request([['Port Cut:', '09/18/2026 25:00']])), /Invalid Port Cut/);
});
