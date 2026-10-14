import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createStub, TOKEN, HOST } from '../fixture.mjs';
const app = resolve(process.argv[2] || fileURLToPath(new URL('../../../../', import.meta.url)));
const require = createRequire(`${app}/package.json`);
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const full = resolve(app, file);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  const source = ts.transpileModule(readFileSync(full, 'utf8'), { fileName: full, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const local = name => {
    if (name.startsWith('.') || name.startsWith('@/')) {
      const path = name.startsWith('@/') ? resolve(app, name.slice(2)) : resolve(dirname(full), name);
      return load(existsSync(path) ? path : path + '.ts');
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', 'console', source)(local, module, module.exports, { log() {}, warn() {} });
  return module.exports;
}
const server = createStub();
await new Promise(resolve => server.listen(0, HOST, resolve));
const base = `http://${HOST}:${server.address().port}`;
const saved = Object.fromEntries(['MCLEOD_BASE_URL', 'MCLEOD_AUTH_TOKEN'].map(k => [k, process.env[k]]));
Object.assign(process.env, { MCLEOD_BASE_URL: base, MCLEOD_AUTH_TOKEN: TOKEN });
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (url, init) => { assert.equal(new URL(url).origin, base, 'Every integration request stays on the local fixture'); return fetchOriginal(url, init); };
const request = (path, body, headers = {}) => fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${TOKEN}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
let checks = 0;
const check = () => { checks++; };
try {
  const { buildPreview } = load('lib/mcleod/inbound/buildPreview.ts');
  const { lookupDriverReference } = load('lib/inbound/checkin/driver-lookup.ts');
  const { searchReferenceOrders } = load('lib/inbound/checkin/reference-search.ts');
  const row = mark => ({ mark, shipper: 'SYNTHETIC', receivedDate: '2026-10-13', balesUnloaded: 88, bolBC: 88, source: 'live_checkin' });
  await assert.rejects(buildPreview([row('60136')], { strictSearch: true }), error => error.code === 'SEARCH_LIMIT_REACHED'); check();
  assert.equal((await (await request('/__mock/report')).json()).writeCount, 0); check();
  await assert.rejects(buildPreview([row('CURRENTFAIL')], { strictSearch: true }), error => error.code === 'LOOKUP_UNAVAILABLE'); check();
  await request('/__mock/scenario', { reference: 'CURRENTFAIL', mode: 'no_match' });
  assert.equal((await buildPreview([row('CURRENTFAIL')], { strictSearch: true }))[0].status, 'No Match'); check();
  await request('/__mock/scenario', { reference: '60136', mode: 'match' });
  assert.equal((await buildPreview([row('60136')], { strictSearch: true }))[0].matchedOrderId, 'MATCH-60136'); check();
  assert.equal((await buildPreview([row('SCM-NORMAL')], { strictSearch: true }))[0].matchedOrderId, 'SCM-NORMAL'); check();
  const formats = ['81382 / 49001932', '81382/ 49001932', '81382 /49001932', '81382/49001932', '81382', '49001932'];
  for (const direction of ['pickup', 'delivery']) for (const ref of formats) {
    const result = await lookupDriverReference(ref, 'HOU', 'Houston 5300', direction);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].orderId, direction === 'pickup' ? 'COMPOUND-PU' : 'COMPOUND-DEL'); check();
    const field = direction === 'pickup' ? 'blnum' : 'consignee_refno';
    const staff = await searchReferenceOrders(async path => (await request(path)).json(), field, ref, AbortSignal.timeout(5000));
    assert.equal(staff.length, 1); check();
  }
  for (const direction of ['pickup', 'delivery']) {
    const dense = await lookupDriverReference('2951', 'HOU', 'Houston 5300', direction);
    assert.equal(dense.matches.length, 1);
    assert.equal(dense.matches[0].orderId, direction === 'pickup' ? 'A-DENSE-PU' : 'A-DENSE-DEL'); check();
    const evidence = await (await request('/__mock/report')).json();
    assert.ok(evidence.requests.some(r => r.query.recordOffset === '25')); check();
  }
  for (const direction of ['pickup', 'delivery']) {
    await assert.rejects(lookupDriverReference('DENSE-CAP-2951', 'HOU', 'Houston 5300', direction), e => e.code === 'INCOMPLETE_LOOKUP'); check();
    const missing = await lookupDriverReference('OUTSIDE-NONE-1014', 'HOU', 'Houston 5300', direction);
    assert.equal(missing.allowUnmatched, true); assert.deepEqual(missing.matches, []); check();
    await assert.rejects(lookupDriverReference('WRONG-YARD-1014', 'HOU', 'Houston 5300', direction), e => e.code === 'YARD_STOP_NOT_FOUND'); check();
    await assert.rejects(lookupDriverReference('NONMAIN-1014', 'HOU', 'Houston 5300', direction), e => e.code === 'NOT_MAIN_ORDER'); check();
    await assert.rejects(lookupDriverReference('PARTIAL-1014', 'HOU', 'Houston 5300', direction), e => e.code === 'DEPENDENCY_UNAVAILABLE'); check();
  }
  const fresh = await lookupDriverReference('SCM-FRESH-1014', 'HOU', 'Houston 5300', 'delivery');
  assert.equal(fresh.matches.length, 1); assert.equal(fresh.matches[0].orderId, 'SCM-FRESH-1014'); check();
  assert.equal((await buildPreview([row('SCM-FRESH-1014')], { strictSearch: true }))[0].matchedOrderId, 'SCM-FRESH-1014'); check();
  assert.equal((await buildPreview([row('OUTSIDE-NONE-1014')], { strictSearch: true }))[0].status, 'No Match'); check();
  const exact = await lookupDriverReference('SCM-NORMAL', 'HOU', 'Houston 5300', 'delivery');
  assert.equal(exact.matches[0].orderId, 'SCM-NORMAL'); assert.ok(exact.matches[0].matchedBy.includes('scm_order')); check();
  const report = await (await request('/__mock/report')).json();
  assert.equal(report.violations.length, 0); assert.equal(report.writeCount, 0); check();
  assert.ok(report.requests.every(r => !Object.hasOwn(r.query, 'orderBy')));
  assert.ok(report.requests.some(r => r.query['orders.blnum'] === '*49001932*' && r.query.recordLength === '5' && r.query.recordOffset === '0'));
  assert.ok(report.requests.some(r => r.query['orders.id'] === 'SCM-NORMAL' && r.query.recordLength === '2')); check();
  for (const type of ['PU', 'SO']) {
    const res = await request(`/carrierDispatch/clearStop/SCM-NORMAL-${type}?arrivalDate=20261013080000-0500&departureDate=20261013090000-0500`, undefined);
    assert.equal(res.status, 404); // GET can never record a fake write.
    const written = await fetch(`${base}/carrierDispatch/clearStop/SCM-NORMAL-${type}?arrivalDate=20261013080000-0500&departureDate=20261013090000-0500`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(written.status, 200); check();
  }
  assert.equal((await (await request('/__mock/report')).json()).writeCount, 2); check();
  const malformedWrite = await fetch(`${base}/carrierDispatch/clearStop/extra/SCM-NORMAL-SO?arrivalDate=20261013080000-0500&departureDate=20261013090000-0500`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(malformedWrite.status, 404);
  assert.equal((await (await request('/__mock/report')).json()).writeCount, 2); check();
  for (const path of ['/orders/UNKNOWN', '/orders/search?orders.blnum=*UNKNOWN*&recordLength=5', '/production', '/orders/search?orders.blnum=*49001932*&recordLength=5&orderBy=id']) {
    assert.ok((await request(path)).status >= 400); check();
  }
  assert.equal((await request('/__mock/health', undefined, { Origin: 'http://127.0.0.1:3000' })).status, 403); check();
  assert.equal((await request('/__mock/health', undefined, { Authorization: 'Bearer real-token-not-allowed' })).status, 401); check();
  assert.equal((await request('/__mock/scenario', { reference: 'UNKNOWN', mode: 'match' })).status, 422); check();
  await request('/__mock/reset', {});
  const reset = await (await request('/__mock/report')).json();
  assert.equal(reset.writeCount, 0); assert.equal(reset.requests.length, 0); assert.equal(reset.scenarios['60136'], 'cap'); check();
  console.log(`PASS ${checks} local fixture checks, including actual app buildPreview and driver/staff lookup functions; no remote requests.`);
} finally {
  globalThis.fetch = fetchOriginal;
  for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  await new Promise(resolve => server.close(resolve));
}
