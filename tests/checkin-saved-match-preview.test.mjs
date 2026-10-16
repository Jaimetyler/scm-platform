import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Load the real production preview code, with no external requests.
const app = resolve(process.cwd());
const require = createRequire(resolve(app, 'package.json'));
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const path = resolve(app, file);
  if (cache.has(path)) return cache.get(path).exports;
  const mod = { exports: {} };
  cache.set(path, mod);
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const local = name => {
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? resolve(app, name.slice(2)) : resolve(dirname(path), name);
      return load(existsSync(target) ? target : `${target}.ts`);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', 'console', source)(local, mod, mod.exports, {log(){},warn(){}});
  return mod.exports;
}
const { buildPreview } = load('lib/mcleod/inbound/buildPreview.ts');
const mark = 'A0372';
const orderId = '0825141';
const row = { source:'live_checkin', mark, shipper:'SYNTHETIC', receivedDate:'2026-10-15', balesUnloaded:89, bolBC:89 };
const baseOrder = { id:orderId, revenue_code_id:'MAIN', consignee_refno:mark, blnum:'A0372 89 BALES', customer_id:'SYNTHETIC', status:'Available', ordered_date:'2026-10-15', stops:[{ id:'delivery-5300',stop_type:'SO',sched_arrive_early:'2026-10-15',location:{name:'Houston 5300'} }] };

async function simulate(order, action, options={}) {
  const oldFetch = globalThis.fetch;
  const oldBase = process.env.MCLEOD_BASE_URL;
  const oldToken = process.env.MCLEOD_AUTH_TOKEN;
  process.env.MCLEOD_BASE_URL = 'https://unit-test-mcleod.invalid';
  process.env.MCLEOD_AUTH_TOKEN = 'fake-token';
  let reads = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin,'https://unit-test-mcleod.invalid');
    assert.equal(init?.method ?? 'GET','GET');
    reads.push(u.pathname);
    assert.equal(u.pathname,`/orders/${orderId}`,'saved match must use only exact order GET');
    return new Response(JSON.stringify(order), { status: options.httpStatus ?? 200, headers: {'Content-Type':'application/json'} });
  };
  let known = 0;
  try {
    const outcome = await action({ strictSearch:true, preferredOrderId:orderId, onKnownMatch:async()=>{known++;} });
    return {outcome, reads, known};
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBase === undefined) delete process.env.MCLEOD_BASE_URL; else process.env.MCLEOD_BASE_URL = oldBase;
    if (oldToken === undefined) delete process.env.MCLEOD_AUTH_TOKEN; else process.env.MCLEOD_AUTH_TOKEN = oldToken;
  }
}

test('A0372 saved SCM order resolves by exact ID without broad mark search', async()=> {
  const {outcome,reads,known} = await simulate(baseOrder, options => buildPreview([row],options));
  assert.equal(outcome[0].status,'Matched');
  assert.equal(outcome[0].matchedOrderId,orderId);
  assert.equal(known,1);
  assert.deepEqual(reads,[`/orders/${orderId}`]);
});
for (const [name, overrides] of [
  ['wrong order ID', {id:'OTHER-ORDER'}],
  ['non-MAIN revenue code', {revenue_code_id:'LOCAL'}],
  ['wrong cotton mark', {consignee_refno:'OTHER',blnum:'OTHER 89 BALES'}],
  ['closed order', {status:'Delivered'}],
  ['missing delivery stop', {stops:[]}],
  ['historical delivery date', {ordered_date:'2026-05-01',stops:[{id:'SO',stop_type:'SO',sched_arrive_early:'2026-05-01'}]}],
]) test(`saved SCM order refuses ${name}`, async()=> {
  const {reads,known}=await simulate({...baseOrder,...overrides}, options => assert.rejects(buildPreview([row],options), error=>error.name==='McleodLookupIncompleteError'));
  assert.equal(known,1);
  assert.deepEqual(reads,[`/orders/${orderId}`]);
});
test('McLeod detail failure never becomes outside-carrier receiving', async()=> {
  const {known}=await simulate(baseOrder, options=>assert.rejects(buildPreview([row],options),error=>error.name==='McleodLookupIncompleteError'),{httpStatus:503});
  assert.equal(known,1);
});
test('downstream live sync still guards customer, saved stop, and warehouse before writing',()=>{
  const source=readFileSync(resolve(app,'app/api/inbound/sync/route.ts'),'utf8');
  assert.match(source,/CUSTOMER_MISMATCH/);
  assert.match(source,/KNOWN_STOP_CONFLICT/);
  assert.match(source,/STAFF_TERMINAL_MISMATCH/);
  assert.ok(source.indexOf('CUSTOMER_MISMATCH') < source.indexOf('await persistLivePhase("write_pending"'));
  assert.ok(source.indexOf('KNOWN_STOP_CONFLICT') < source.indexOf('await persistLivePhase("write_pending"'));
});
