import assert from 'node:assert/strict';
import test from 'node:test';
import { searchReferenceOrders } from '../lib/inbound/checkin/reference-search.ts';
import { DependencyError } from '../lib/http/dependency.ts';

const formats = ['81382 / 49001932', '81382/ 49001932', '81382 /49001932', '81382/49001932'];
const row = (id, field, value, extra = {}) => ({ id, revenue_code_id: 'MAIN', [field]: value, ...extra });

// Apply the literal anchor and real offset slicing. Returning a target for every
// query would conceal a wrong full-input or short-component retrieval strategy.
function pagedRead(rows, field) {
  const calls = [];
  const read = async path => {
    const url = new URL(path, 'https://mcleod.invalid'); calls.push(url);
    assert.equal(url.pathname, '/orders/search');
    assert.deepEqual([...url.searchParams.keys()].sort(), [`orders.${field}`, 'recordLength', 'recordOffset'].sort());
    assert.equal(url.searchParams.get('recordLength'), '5');
    const pattern = url.searchParams.get(`orders.${field}`);
    assert.ok(pattern.startsWith('*') && pattern.endsWith('*'));
    const anchor = pattern.slice(1, -1);
    assert.ok(anchor && !/[*?]/.test(anchor), 'Only one literal necessary anchor, no invented wildcard grammar');
    const offset = Number(url.searchParams.get('recordOffset'));
    assert.ok(Number.isInteger(offset) && offset >= 0 && offset % 5 === 0);
    return rows.filter(value => value[field].toUpperCase().includes(anchor))
      .sort((left, right) => left.id < right.id ? 1 : left.id > right.id ? -1 : 0).slice(offset, offset + 5);
  };
  return { read, calls };
}
const lookup = (read, field, input, signal = new AbortController().signal) => searchReferenceOrders(read, field, input, signal);

test('both fields retrieve every stored/input slash-spacing combination and preserve the stored value', async () => {
  for (const field of ['blnum', 'consignee_refno']) for (const stored of formats)
    for (const input of [...formats, '81382', '49001932']) {
      const expected = row('COMPOUND', field, stored);
      const { read, calls } = pagedRead([expected], field);
      assert.deepEqual(await lookup(read, field, input), [expected], `${field}: ${stored} / ${input}`);
      assert.equal(expected[field], stored, 'Normalization never rewrites the stored reference');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].searchParams.get(`orders.${field}`), `*${input.includes('/') ? '49001932' : input}*`);
    }
});

test('a compound uses its longer necessary anchor even when the short component has more than 100 raw hits', async () => {
  for (const field of ['blnum', 'consignee_refno']) {
    const target = row('REAL', field, '2951 / 4500281026');
    const rows = [target, ...Array.from({ length: 150 }, (_, index) => row(`FALSE-${index}`, field, `129510-${index}`))];
    const { read, calls } = pagedRead(rows, field);
    assert.deepEqual(await lookup(read, field, '2951/ 4500281026'), [target]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get(`orders.${field}`), '*4500281026*');
  }
});

test('all supplied components must occur together in order in one field on one order', async () => {
  for (const field of ['blnum', 'consignee_refno']) {
    const otherField = field === 'blnum' ? 'consignee_refno' : 'blnum';
    const rows = [
      row('ONLY-FIRST', field, '81382'), row('ONLY-SECOND', field, '49001932'),
      row('CROSS-FIELD', field, '49001932', { [otherField]: '81382' }),
      row('WRONG-FIRST', field, 'WRONG / 49001932'), row('WRONG-SECOND', field, '81382 / WRONG'),
      row('REVERSED', field, '49001932 / 81382'), row('SEPARATED', field, '81382 / OTHER / 49001932'),
      row('FIRST-SUBSTRING', field, '181382 / 49001932'), row('SECOND-SUBSTRING', field, '81382 / 490019320'),
    ];
    const { read } = pagedRead(rows, field);
    assert.deepEqual(await lookup(read, field, '81382/49001932'), []);
  }
});

test('retrieval preserves meaningful hyphenated references and leading zeroes', async () => {
  const field = 'blnum';
  const target = row('PADDED', field, 'ABC-00012 / 0049001932');
  const rows = [target, row('NO-ZERO', field, 'ABC-00012 / 49001932'),
    row('EXTRA-HYPHEN', field, 'ABC-X-00012 / 0049001932'), row('FRAGMENT', field, 'ABC-000120 / 0049001932')];
  const { read, calls } = pagedRead(rows, field);
  assert.deepEqual(await lookup(read, field, 'abc-00012/0049001932'), [target]);
  assert.equal(calls[0].searchParams.get('orders.blnum'), '*0049001932*');
  const full = pagedRead(rows, field);
  assert.deepEqual(await lookup(full.read, field, 'abc-00012'), [target, rows[1]]);
  assert.equal(full.calls[0].searchParams.get('orders.blnum'), '*ABC-00012*', 'Never split hyphenated input into alternatives');
});

test('a first-page full-field compound match does not hide later multi-valued matches', async () => {
  const field = 'blnum';
  const first = row('Z-EXACT', field, '81382/49001932');
  const later = row('A-MULTI', field, 'OTHER / 81382 /49001932 / LAST');
  const rows = [first, later, ...Array.from({ length: 4 }, (_, index) => row(`M-FALSE-${index}`, field, '490019320'))];
  const { read, calls } = pagedRead(rows, field);
  assert.deepEqual(await lookup(read, field, '81382 / 49001932'), [first, later]);
  assert.deepEqual(calls.map(url => url.searchParams.get('recordOffset')), ['0', '5']);
});

test('an overbroad compound anchor still fails closed at the unchanged 100-row cap', async () => {
  const field = 'blnum';
  const rows = [row('Z-EXACT', field, '81382/49001932'),
    ...Array.from({ length: 100 }, (_, index) => row(`FALSE-${String(index).padStart(3, '0')}`, field, '490019320'))];
  const { read, calls } = pagedRead(rows, field);
  await assert.rejects(lookup(read, field, '81382 / 49001932'), error => error.code === 'INCOMPLETE_LOOKUP');
  assert.equal(calls.length, 20); assert.equal(calls.at(-1).searchParams.get('recordOffset'), '95');
});

test('short standalone references retain broad retrieval and its fail-closed cap', async () => {
  const field = 'blnum';
  const rows = Array.from({ length: 101 }, (_, index) => row(`FALSE-${index}`, field, '129510'));
  const { read, calls } = pagedRead(rows, field);
  await assert.rejects(lookup(read, field, '2951'), error => error.code === 'INCOMPLETE_LOOKUP');
  assert.equal(calls.length, 20);
  assert.ok(calls.every(url => url.searchParams.get('orders.blnum') === '*2951*'));
});

test('search validates raw input before normalization and never drops a control or wildcard', async () => {
  for (const input of ['81382 /\n49001932', '81382 /*49001932', '81382 /?49001932']) {
    await assert.rejects(lookup(() => assert.fail('No request for invalid input'), 'blnum', input),
      error => error.code === 'INVALID_LOOKUP_INPUT');
  }
});

test('anchor failures and repeated pages remain uncertainty rather than no-match', async () => {
  const repeated = Array.from({ length: 5 }, (_, index) => row(`ROW-${index}`, 'blnum', '49001932'));
  await assert.rejects(lookup(async () => repeated, 'blnum', '81382/49001932'), DependencyError);
  await assert.rejects(lookup(async () => { throw new Error('read failed'); }, 'blnum', '81382/49001932'), DependencyError);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(lookup(() => assert.fail('No request after cancellation'), 'blnum', '81382/49001932', aborted.signal), DependencyError);
});
