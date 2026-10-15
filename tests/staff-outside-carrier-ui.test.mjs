import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mergePollingRows } from '../lib/polling/merge-rows.ts';

// Run the real staff page, review component, and their handlers. All fetches and
// polling are mock boundaries; this suite cannot contact McLeod or Supabase.
const reviewPath = '../components/warehouse/OutsideCarrierReview.tsx';
const linePath = '../app/warehouse/gate/[terminal]/[siteCode]/line/page.tsx';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const json = (body, status = 200) => Response.json(body, { status });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const row = (extra = {}) => ({ terminal: 'HOU', site_code: '5300', id: '11111111-1111-4111-8111-111111111111', updated_at: '2026-10-13T10:00:00Z',
  checked_in_at: '2026-10-13T09:00:00Z', yard_status: 'working', draft_status: 'failed', material_type: 'cotton',
  movement_direction: 'delivery', driver_name: 'Test Driver', trucking_company: 'Test Carrier', reference_number: '60136',
  matched_order_id: null, matched_stop_id: null, mcleod_lookup_status: 'unresolved', mcleod_processing_phase: 'lookup',
  mcleod_lookup_attempt_id: '22222222-2222-4222-8222-222222222222', outside_carrier_override_eligible: true,
  mark: 'MARK', shipper: 'CUSTOMER', bol_bc: 90, bale_count: 90, warehouse_location: 'A1', equipment_type: 'V',
  has_bol_photo: true, comment_1: 'Existing notes', ...extra });
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
}
function all(node, test) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(n => all(n, test));
  return [...(test(node) ? [node] : []), ...all(node.props?.children, test)];
}
async function mount({ page = false, initialRow = row(), canWrite = true, readSaved, storage = new Map(), respond = () => json({ ok: true,
  row: row({ yard_status: 'completed', outside_carrier_override_at: '2026-10-13T11:00:00Z', outside_carrier_override_eligible: false }) }) } = {}) {
  const instances = new Map(), calls = [], reads = [], completed = [], busyChanges = [], openChanges = [], polling = [];
  let current, cursor, dirty = true, tree, effects = [], serverRows = [initialRow], params = { terminal: 'HOU', siteCode: '5300' };
  let props, disposed = false, root;
  const hooks = {
    useState(initial) {
      const slots = current.slots, index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }];
    },
    useRef(initial) { const slots = current.slots, index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(fn, deps) {
      const slots = current.slots, index = cursor++, old = slots[index];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) {
        slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const jsx = (type, props, key) => ({ type, props, key });
  const passthrough = props => jsx('div', props);
  const fetch = async (url, options = {}) => {
    if (!options.method) {
      if (new URL(url, 'https://fixture.invalid').searchParams.has('id')) { reads.push({ url, options }); return readSaved ? readSaved(url, options) : json({ ok: true, row: serverRows[0] }); }
      return json({ ok: true, rows: serverRows });
    }
    const call = { url, options, body: JSON.parse(options.body) }; calls.push(call);
    const response = await respond(call.body, call.options, calls);
    const result = await response.clone().json().catch(()=>({}));
    if (result.ok && result.row?.id) serverRows = serverRows.map(row => row.id === result.row.id ? { ...row, ...result.row } : row);
    return response;
  };
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/navigation': { useParams: () => params }, 'next/link': { default: passthrough },
    '@/components/auth/StaffSession': { useCanWrite: () => canWrite },
    '@/components/warehouse/useVisiblePolling': { useVisiblePolling(options) {
      const active = hooks.useRef(null);
      hooks.useEffect(() => {
        if (!options.enabled) return;
        const controller = new AbortController(); active.current = controller; polling.push({ ...options, controller });
        void options.load(controller.signal);
        return () => { controller.abort(); active.current = null; };
      }, [options.enabled, options.requestKey]);
      return { refresh: () => active.current ? options.load(active.current.signal) : Promise.resolve() };
    } },
    '@/components/warehouse/PollingStatus': { default: () => null },
    '@/components/warehouse/SourceLoadAlerts': { default: () => null },
    '@/components/platform/PlatformPageHeader': { default: passthrough },
    '@/components/platform/PlatformPanel': { default: passthrough },
    '@/components/warehouse/ScmOrderBadge': { default: () => null },
    '@/components/warehouse/PaperworkPhotoLink': { default: () => jsx('span', { children: 'Paperwork photo' }) },
    '@/components/warehouse/domestic-tables.css': {},
    '@/lib/inbound/checkin/sites': { getCheckinSite: (terminal, siteCode) => ({ terminal, siteCode, siteName: `${terminal} ${siteCode}`, terminalSlug: terminal.toLowerCase() }) },
    '@/lib/polling/merge-rows': { mergePollingRows },
    '@/lib/inbound/checkin/shortage': { cottonShortage: () => null },
  };
  const load = path => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'fetch', 'window', 'sessionStorage', compile(path))(
      name => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; }, module, module.exports, fetch, { confirm: () => true }, { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
    return module.exports;
  };
  const review = load(reviewPath); modules['@/components/warehouse/OutsideCarrierReview'] = review;
  root = page ? load(linePath).default : review.default;
  props = page ? {} : { row: initialRow, terminal: 'HOU', siteCode: '5300', canWrite, busy: false,
    onRetry: () => calls.push({ retry: true }), onBusy: value => busyChanges.push(value), onOpenChange: value => openChanges.push(value),
    onComplete: (...args) => completed.push(args), onReconcile: saved => { props = { ...props, row: saved }; dirty = true; } };
  function expand(node, path = 'root') {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}/${child?.key ?? i}`));
    if (typeof node.type === 'function') {
      const key = `${path}/${node.type.name}/${node.key ?? ''}`;
      const instance = instances.get(key) ?? { slots: [], used: true };
      instances.set(key, instance); instance.used = true;
      current = instance; cursor = 0;
      return expand(node.type(node.props), `${key}/view`);
    }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/${node.type}`) } };
  }
  function render() {
    dirty = false; effects = []; for (const instance of instances.values()) instance.used = false;
    tree = expand(jsx(root, props));
    for (const [key, instance] of instances) if (!instance.used) { for (const slot of instance.slots) slot?.cleanup?.(); instances.delete(key); }
    effects.forEach(fn => fn());
  }
  async function flush() { for (let i = 0; i < 35; i++) { if (dirty && !disposed) render(); await Promise.resolve(); } }
  const api = {
    calls, reads, storage, completed, busyChanges, openChanges, polling, review, flush,
    text: () => textOf(tree), nodes: pred => all(tree, pred),
    button(text) { const n = all(tree, n => n.type === 'button' && textOf(n) === text)[0]; assert.ok(n, `Missing button: ${text}`); return n; },
    input(label) {
      const n = all(tree, n => n.type === 'label' && textOf(n).trim().startsWith(label))[0]; assert.ok(n, `Missing label: ${label}`);
      return all(n, n => ['input', 'textarea', 'select'].includes(n.type))[0];
    },
    async click(text) { const n = api.button(text); assert.notEqual(n.props.disabled, true); n.props.onClick(); await flush(); },
    async change(label, value) { api.input(label).props.onChange({ target: { value, checked: value } }); await flush(); },
    async update(next) { props = { ...props, ...next }; dirty = true; await flush(); },
    async role(value) { canWrite = value; props = { ...props, canWrite: value }; dirty = true; await flush(); },
    async navigate(siteCode) { params = { ...params, siteCode }; serverRows = []; dirty = true; await flush(); },
    async submitForm() { const n = all(tree, n => n.type === 'form')[0]; n.props.onSubmit({ preventDefault() {} }); await flush(); },
    dispose() { disposed = true; for (const instance of instances.values()) for (const slot of instance.slots) slot?.cleanup?.(); },
  };
  await flush(); return api;
}
async function confirm(h) {
  assert.ok(h.button('Process as Outside Carrier'));
}

test('outside option requires server eligibility and typed persisted lookup-only failure; known matches and pending writes stay blocked', async t => {
  const h = await mount(); t.after(h.dispose);
  assert.equal(h.review.canReviewOutsideCarrier(row()), true);
  for (const change of [{ outside_carrier_override_eligible: false }, { outside_carrier_override_eligible: undefined },
    { mcleod_lookup_status: null }, { mcleod_processing_phase: 'write_pending' }, { mcleod_processing_phase: 'processing' },
    { draft_status: 'processing' }, { matched_order_id: 'KNOWN' }, { matched_stop_id: 'STOP' }, { mcleod_lookup_attempt_id: '' },
    { yard_status: 'completed' }, { material_type: 'lumber' }, { movement_direction: 'pickup' }]) {
    const next = row(change); assert.equal(h.review.canReviewOutsideCarrier(next), false, JSON.stringify(change));
    await h.update({ row: next }); assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  }
});

test('confirmation needs one clear final click, no typed reason or checkbox, and sends only override metadata', async t => {
  const h = await mount(); t.after(h.dispose);
  assert.equal(h.calls.length, 0);
  assert.match(h.text(), /physical movement as completed/); assert.match(h.text(), /No McLeod update will be sent/);
  assert.equal(h.nodes(n => n.type === 'textarea' || n.type === 'input').length, 0);
  await h.click('Process as Outside Carrier');
  assert.equal(h.calls.length, 1); assert.equal(h.completed.length, 1);
  const body = h.calls[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['action','id','terminal','siteCode','expectedUpdatedAt','lookupAttemptId','acknowledgeUnresolved','requestId'].sort());
  assert.equal(body.action, 'process_outside_carrier'); assert.equal(body.reason, undefined);
  assert.equal(body.acknowledgeUnresolved, true); assert.equal(body.expectedUpdatedAt, row().updated_at);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
});

test('repeat clicks are coalesced and ambiguous retry retains the same request ID, including Cancel and retry', async t => {
  const pending = deferred(); let attempts = 0;
  const h = await mount({ respond: () => ++attempts === 1 ? pending.promise : json({ ok: false, error: 'Temporarily unavailable' }, 503) }); t.after(h.dispose);
  await confirm(h);
  const submit = h.button('Process as Outside Carrier').props.onClick;
  submit(); submit(); await h.flush(); assert.equal(h.calls.length, 1);
  assert.equal(h.button('Cancel').props.disabled, true);
  pending.resolve(json({ ok: false, error: 'Response could not be confirmed' }, 503)); await h.flush();
  await h.click('Process as Outside Carrier'); assert.equal(h.calls[0].body.requestId, h.calls[1].body.requestId);
  await h.click('Cancel'); submit(); await h.flush(); assert.equal(h.calls.length, 2);
  assert.equal(h.button('Process as Outside Carrier').props.disabled, false);
  await h.click('Process as Outside Carrier');
  assert.equal(h.calls[2].body.requestId, h.calls[0].body.requestId);
  await h.update({ row: row({ updated_at: '2026-10-13T12:00:00Z' }) }); await confirm(h);
  await h.click('Process as Outside Carrier');
  assert.notEqual(h.calls[3].body.requestId, h.calls[0].body.requestId);
});

test('read-only roles, changed attempts, and stale submit callbacks cannot bypass confirmation', async t => {
  const h = await mount(); t.after(h.dispose); await confirm(h);
  const submit = h.button('Process as Outside Carrier').props.onClick;
  await h.role(false); submit(); await h.flush(); assert.equal(h.calls.length, 0);
  await h.role(true); await h.update({ row: row({ updated_at: 'new', mcleod_lookup_attempt_id: 'new-attempt' }) });
  submit(); await h.flush(); assert.equal(h.calls.length, 0); assert.doesNotMatch(h.text(), /Saving…/);
  await h.click('Retry Search'); assert.deepEqual(h.calls, [{ retry: true }]);
});

test('unmount/navigation aborts pending confirmation and suppresses late completion callbacks', async t => {
  const pending = deferred(); const h = await mount({ respond: () => pending.promise }); t.after(h.dispose);
  await confirm(h); await h.click('Process as Outside Carrier'); h.dispose();
  assert.equal(h.calls[0].options.signal.aborted, true);
  pending.resolve(json({ ok: true, row: row({ yard_status: 'completed' }) })); await h.flush();
  assert.equal(h.completed.length, 0);
});

test('line keeps receiving edits and arrival evidence through a failed finish; saved recovery supplies the next revision', async t => {
  const failed = row({ updated_at: '2026-10-13T10:10:00Z', warehouse_location: 'CUSTOM A2' });
  const h = await mount({ page: true, initialRow: row({ draft_status: 'checked_in', outside_carrier_override_eligible: false }),
    readSaved: () => json({ ok: true, row: failed }),
    respond: () => json({ ok: false, code: 'CHECKOUT_UNCERTAIN', row: failed, error: 'Saved status uncertain' }, 503) }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.change('Warehouse location', 'CUSTOM A2'); await h.submitForm();
  assert.equal(h.calls.length, 1); assert.ok(h.button('Refresh saved status'));
  assert.equal(h.input('Warehouse location').props.value, 'CUSTOM A2');
  assert.match(h.text(), /Test Driver/); assert.match(h.text(), /Test Carrier/); assert.match(h.text(), /60136/); assert.match(h.text(), /Paperwork photo/);
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  await h.submitForm(); assert.equal(h.calls.length, 1);
  await h.click('Refresh saved status'); assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1);
  await h.click('Finish cotton'); await h.submitForm(); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].body.expectedUpdatedAt, failed.updated_at);
  assert.equal(h.calls[1].body.cotton.warehouseLocation, 'CUSTOM A2');
  assert.equal(h.calls[1].body.finishCottonRequestId, h.calls[0].body.finishCottonRequestId);
});

test('line blocks implicit outside processing on generic errors and coalesces normal checkout submits', async t => {
  const pending = deferred(); const h = await mount({ page: true,
    initialRow: row({ draft_status: 'checked_in', outside_carrier_override_eligible: false }), respond: () => pending.promise }); t.after(h.dispose);
  await h.click('Finish cotton'); const submit = h.nodes(n => n.type === 'form')[0].props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await h.flush(); assert.equal(h.calls.length, 1);
  pending.resolve(json({ ok: false, error: 'McLeod search incomplete...cannot classify outside carrier' }, 409)); await h.flush();
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/); assert.equal(h.input('Mark').props.value, 'MARK');
});

test('normal Finish cotton pauses polling and shows the automatic unresolved completion without another confirmation', async t => {
  const h = await mount({ page: true }); t.after(h.dispose);
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/); assert.equal(h.calls.length, 0);
  await h.click('Finish cotton');
  assert.equal(h.polling[0].controller.signal.aborted, true);
  assert.equal(h.calls.length, 0); await h.submitForm();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.action, 'checkout');
  assert.match(h.calls[0].body.finishCottonRequestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(h.calls[0].body.acknowledgeUnresolved, undefined);
  assert.equal(h.calls[0].body.cotton.warehouseLocation, 'A1');
  assert.match(h.text(), /Completed movements · SCM verification unresolved/);
  assert.match(h.text(), /Outside carrier · SCM verification unresolved · No McLeod update/);
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  assert.match(h.text(), /No active domestic arrivals/);
});

test('line navigation aborts checkout and ignores its late response', async t => {
  const pending = deferred(); const h = await mount({ page: true,
    initialRow: row({ draft_status: 'checked_in', outside_carrier_override_eligible: false }), respond: () => pending.promise }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.submitForm(); await h.navigate('NEW');
  assert.equal(h.calls[0].options.signal.aborted, true);
  pending.resolve(json({ ok: false, code: 'MCLEOD_LOOKUP_UNRESOLVED', outsideCarrierEligible: true, row: row(), error: 'Old site failure' }, 409)); await h.flush();
  assert.doesNotMatch(h.text(), /Old site failure|Process as Outside Carrier|Test Driver/);
});

test('confirmation timeout releases Saving without claiming failure to commit and retries with the same ID', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const h = await mount({ respond: (_body, options) => ++attempts === 1
    ? new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    : json({ ok: false, error: 'Please refresh' }, 409) }); t.after(h.dispose);
  await confirm(h); await h.click('Process as Outside Carrier');
  assert.ok(h.button('Saving…')); t.mock.timers.tick(20000); await h.flush();
  assert.match(h.text(), /may already have completed/); assert.equal(h.busyChanges.at(-1), false);
  await h.click('Process as Outside Carrier'); assert.equal(h.calls[0].body.requestId, h.calls[1].body.requestId);
});

test('changing a persisted lookup attempt releases parent locks and suppresses the old in-flight response', async t => {
  const pending = deferred(); const h = await mount({ respond: () => pending.promise }); t.after(h.dispose);
  await confirm(h); await h.click('Process as Outside Carrier');
  await h.update({ row: row({ updated_at: 'changed', mcleod_lookup_attempt_id: 'new-attempt' }) });
  assert.equal(h.calls[0].options.signal.aborted, true); assert.equal(h.busyChanges.at(-1), false); assert.equal(h.openChanges.at(-1), false);
  pending.resolve(json({ ok: true, row: row({ yard_status: 'completed' }) })); await h.flush(); assert.equal(h.completed.length, 0);
});

test('re-clicking Finish cotton preserves in-progress fields; Cancel does not write or implicitly override', async t => {
  const h = await mount({ page: true }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.change('Mark', 'MY EDIT'); await h.click('Finish cotton');
  assert.equal(h.input('Mark').props.value, 'MY EDIT');
  await h.click('Cancel'); assert.equal(h.calls.length, 0);
  assert.doesNotMatch(h.text(), /Saving…/);
  assert.equal(h.nodes(n => n.type === 'form').length, 0);
});


test('interrupted lookup recovery is retry-only and uses persisted receiving data', async t => {
  const recovery = row({ draft_status: 'processing', mcleod_lookup_status: 'pending', lookup_retry_eligible: true, outside_carrier_override_eligible: false });
  const h = await mount({ page: true, initialRow: recovery, respond: () => json({ ok: false, code: 'MCLEOD_LOOKUP_UNRESOLVED',
    outsideCarrierEligible: true, row: row({ updated_at: 'new-version' }), error: 'Search remains unresolved' }, 409) }); t.after(h.dispose);
  assert.ok(h.button('Retry Search')); assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  await h.click('Retry Search');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.action, 'retry_lookup');
  assert.equal(h.calls[0].body.expectedUpdatedAt, recovery.updated_at); assert.equal(h.calls[0].body.cotton, undefined);
  assert.ok(h.button('Finish cotton')); assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  for (const changes of [{ lookup_retry_eligible: false }, { mcleod_processing_phase: 'write_pending' },
    { matched_order_id: 'known' }, { mcleod_lookup_status: 'complete' }, { yard_status: 'completed' }]) {
    assert.equal(h.review.canRetryInterruptedLookup({ ...recovery, ...changes }), false);
  }
});

test('stale callbacks cannot submit an override for a previous site scope', async t => {
  const h = await mount(); t.after(h.dispose); await confirm(h);
  const oldSubmit = h.button('Process as Outside Carrier').props.onClick;
  await h.update({ siteCode: 'new-site' }); await confirm(h);
  oldSubmit(); await h.flush(); assert.equal(h.calls.length, 0);
  await h.click('Process as Outside Carrier'); assert.equal(h.calls[0].body.siteCode, 'new-site');
});

test('pending or legacy-uncertain writes keep the arrival active and cannot Finish or Remove, even through stale handlers', async t => {
  for (const changes of [
    { mcleod_processing_phase: 'write_pending', matched_order_id: 'KNOWN-ORDER' },
    { mcleod_processing_phase: 'write_pending' },
    { mcleod_processing_phase: 'legacy_processing' },
    { mcleod_processing_phase: 'legacy_review' },
    { draft_status: 'processing', mcleod_processing_phase: 'matched', matched_order_id: 'KNOWN-ORDER' },
  ]) {
    const h = await mount({ page: true, initialRow: row(changes) }); t.after(h.dispose);
    assert.equal(h.button('Finish cotton').props.disabled, true);
    assert.equal(h.button('Remove').props.disabled, true);
    h.button('Finish cotton').props.onClick(); h.button('Remove').props.onClick(); await h.flush();
    assert.equal(h.calls.length, 0); assert.equal(h.nodes(n => n.type === 'form').length, 0);
    assert.match(h.text(), /McLeod status needs review/); assert.match(h.text(), /1 active/);
    assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  }
});

test('legitimate known matches still allow ordinary cotton completion without manual outside override', async t => {
  const h = await mount({ page: true, initialRow: row({ draft_status: 'checked_in', mcleod_processing_phase: 'matched',
    matched_order_id: 'KNOWN-ORDER', matched_stop_id: 'KNOWN-STOP' }) }); t.after(h.dispose);
  assert.equal(h.button('Finish cotton').props.disabled, false);
  assert.doesNotMatch(h.text(), /Process as Outside Carrier|McLeod status needs review/);
  await h.click('Finish cotton'); await h.submitForm();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.action, 'checkout');
});

test('a pending-write response disables an already-open receiving form and rejects its old submit closure', async t => {
  const h = await mount({ page: true, initialRow: row({ draft_status: 'checked_in', outside_carrier_override_eligible: false }),
    respond: () => json({ ok: false, code: 'MCLEOD_WRITE_UNCERTAIN', row: row({ updated_at: '2026-10-13T12:00:00Z',
      mcleod_processing_phase: 'write_pending', matched_order_id: 'KNOWN-ORDER', outside_carrier_override_eligible: false }), error: 'Reconcile pending write' }, 409) }); t.after(h.dispose);
  await h.click('Finish cotton'); const oldSubmit = h.nodes(n => n.type === 'form')[0].props.onSubmit;
  await h.submitForm(); assert.equal(h.calls.length, 1);
  assert.ok(h.nodes(n => n.type === 'button' && textOf(n) === 'Finish cotton').every(n => n.props.disabled === true));
  oldSubmit({ preventDefault() {} }); await h.submitForm(); h.button('Remove').props.onClick(); await h.flush();
  assert.equal(h.calls.length, 1); assert.match(h.text(), /1 active/);
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
});


test('only server-approved legacy pre-write cap offers a fresh Retry Search, never immediate manual checkout', async t => {
  const legacy = row({ draft_status: 'failed', mcleod_processing_phase: 'legacy_review', mcleod_lookup_status: null,
    mcleod_lookup_attempt_id: null, outside_carrier_override_eligible: false, lookup_prepare_eligible: true,
    processing_error: 'McLeod search incomplete (result limit reached); cannot classify outside carrier. Review McLeod search logs.' });
  const h = await mount({ page: true, initialRow: legacy, respond: () => json({ ok: false, code: 'MCLEOD_LOOKUP_UNRESOLVED',
    outsideCarrierEligible: true, row: row({ updated_at: '2026-10-13T12:00:00Z' }), error: 'Fresh lookup incomplete' }, 409) }); t.after(h.dispose);
  assert.ok(h.button('Retry Search')); assert.equal(h.button('Remove').props.disabled, true);
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
  await h.click('Retry Search'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.action, 'checkout'); assert.equal(h.calls[0].body.expectedUpdatedAt, legacy.updated_at);
  assert.equal(h.calls[0].body.cotton.mark, legacy.mark); assert.equal(h.calls[0].body.cotton.baleCount, '90');
  assert.ok(h.button('Refresh saved status')); // A failed Finish remains fenced until the saved state is read.
  assert.doesNotMatch(h.text(), /Process as Outside Carrier/);
});

test('generic legacy failures and an exact-looking error without the server flag remain review-only', async t => {
  for (const extra of [
    { lookup_prepare_eligible: false, processing_error: 'McLeod search incomplete (result limit reached); cannot classify outside carrier. Review McLeod search logs.' },
    { lookup_prepare_eligible: undefined, processing_error: 'Timed out while updating McLeod' },
    { lookup_prepare_eligible: true, matched_order_id: 'KNOWN-ORDER' },
    { lookup_prepare_eligible: true, mcleod_lookup_has_known_match: true },
  ]) {
    const h = await mount({ page: true, initialRow: row({ mcleod_processing_phase: 'legacy_review', ...extra }) }); t.after(h.dispose);
    assert.doesNotMatch(h.text(), /Retry Search|Process as Outside Carrier/); assert.match(h.text(), /needs review/);
    h.button('Finish cotton').props.onClick(); h.button('Remove').props.onClick(); await h.flush(); assert.equal(h.calls.length, 0);
  }
});

test('interrupted lookup retry supports typed outcomes saved before the outer handler stopped, without manual processing permission', async t => {
  const h = await mount(); t.after(h.dispose);
  for (const status of ['pending', 'searching', 'unresolved', 'conflict', 'error']) {
    const pending = row({ draft_status: 'processing', mcleod_lookup_status: status, lookup_retry_eligible: true });
    assert.equal(h.review.canRetryInterruptedLookup(pending), true);
    assert.equal(h.review.canReviewOutsideCarrier(pending), false);
  }
});

test('a read-only staff role cannot start the server-approved legacy fresh lookup', async t => {
  const h = await mount({ page: true, canWrite: false, initialRow: row({ mcleod_processing_phase: 'legacy_review',
    lookup_prepare_eligible: true, outside_carrier_override_eligible: false }) }); t.after(h.dispose);
  assert.equal(h.button('Retry Search').props.disabled, true);
  h.button('Retry Search').props.onClick(); await h.flush(); assert.equal(h.calls.length, 0);
});

test('uncertain Finish cotton remains fenced through Cancel until a scoped saved-status read', async t => {
  const h = await mount({ page: true, respond: () => json({ ok: false, error: 'Response uncertain' }, 503) }); t.after(h.dispose);
  await h.click('Finish cotton'); const stale = h.nodes(n => n.type === 'form')[0].props.onSubmit;
  await h.submitForm(); assert.equal(h.calls.length, 1);
  stale({ preventDefault() {} }); await h.flush(); assert.equal(h.calls.length, 1);
  await h.click('Cancel'); await h.click('Finish cotton'); await h.submitForm();
  assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 0);
  await h.click('Refresh saved status'); assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1);
  await h.click('Finish cotton'); await h.submitForm();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.action, 'checkout');
  assert.equal(h.calls[1].body.finishCottonRequestId, h.calls[0].body.finishCottonRequestId);
});


test('saved-status refresh reconciles another tab completion without an additional write', async t => {
  const saved = row({ updated_at:'2026-10-13T11:00:00Z',yard_status:'completed',draft_status:'outside_carrier',outside_carrier_override_eligible:false,outside_carrier_override_at:'2026-10-13T11:00:00Z' });
  const h=await mount({page:true, respond:()=>json({ok:false,error:'Outcome uncertain'},503),readSaved:()=>json({ok:true,row:saved})});t.after(h.dispose);
  await h.click('Finish cotton'); await h.submitForm(); assert.equal(h.button('Refresh').props.disabled,true);
  assert.equal(h.button('Refresh saved status').props.disabled,false);
  await h.click('Refresh saved status');assert.equal(h.calls.length,1);assert.equal(h.reads.length,1);assert.match(h.text(),/This movement is completed/);
  assert.match(h.text(),/Completed movements/);assert.doesNotMatch(h.text(),/Process as Outside Carrier/);
  assert.equal(h.button('Refresh').props.disabled,false);
});

test('response lost after commit retries the same request after Cancel and unchanged saved-status read',async t=>{
  const ids=new Set();let receipts=0;let attempts=0;
  const h=await mount({respond:body=>{if(!ids.has(body.requestId)){ids.add(body.requestId);receipts++;}if(++attempts===1)throw new Error('Response lost after commit');return json({ok:true,row:row({yard_status:'completed'})});}});t.after(h.dispose);
  await h.click('Process as Outside Carrier');const requestId=h.calls[0].body.requestId;
  await h.click('Refresh saved status');assert.equal(h.calls.length,1);
  await h.click('Cancel');await h.click('Process as Outside Carrier');
  assert.equal(h.calls[1].body.requestId,requestId);assert.equal(receipts,1);assert.equal(h.completed.length,1);
});

test('real conflict fences resubmit including stale callbacks until scoped status refresh',async t=>{
  const h=await mount({respond:()=>json({ok:false,code:'CHECKOUT_CONFLICT',error:'This arrival changed'},409)});t.after(h.dispose);
  const stale=h.button('Process as Outside Carrier').props.onClick;
  await h.click('Process as Outside Carrier');assert.equal(h.button('Process as Outside Carrier').props.disabled,true);
  stale();await h.flush();assert.equal(h.calls.length,1);
  await h.click('Cancel');assert.equal(h.button('Process as Outside Carrier').props.disabled,true);
  assert.equal(h.button('Retry Search').props.disabled,true);h.button('Retry Search').props.onClick();await h.flush();assert.equal(h.calls.length,1);
  await h.click('Refresh saved status');assert.equal(h.calls.length,1);assert.equal(h.button('Process as Outside Carrier').props.disabled,false);
});

test('failed, stale, partial and wrong-yard saved reads never clear a conflict or update completion',async t=>{
  for(const response of [()=>json({ok:false,error:'Unavailable'},503),()=>json({ok:true,row:row({updated_at:'2026-10-12T10:00:00Z'})}),
    ()=>json({ok:true,row:row({site_code:'4331'})}),()=>json({ok:true,row:{id:row().id}})]){
    const h=await mount({respond:()=>json({ok:false,error:'Conflict'},409),readSaved:response});t.after(h.dispose);
    await h.click('Process as Outside Carrier');await h.click('Refresh saved status');
    assert.equal(h.calls.length,1);assert.equal(h.completed.length,0);assert.equal(h.button('Process as Outside Carrier').props.disabled,true);
    assert.equal(h.button('Refresh saved status').props.disabled,false);
  }
});

test('newer saved attempt replaces stale confirmation without submitting automatically',async t=>{
  const newer=row({updated_at:'2026-10-13T11:00:00Z',mcleod_lookup_attempt_id:'44444444-4444-4444-8444-444444444444'});
  const h=await mount({respond:()=>json({ok:false,error:'Uncertain'},503),readSaved:()=>json({ok:true,row:newer})});t.after(h.dispose);
  const stale=h.button('Process as Outside Carrier').props.onClick;
  await h.click('Process as Outside Carrier');await h.click('Refresh saved status');stale();await h.flush();assert.equal(h.calls.length,1);
  await h.click('Process as Outside Carrier');assert.equal(h.calls[1].body.lookupAttemptId,newer.mcleod_lookup_attempt_id);
  assert.notEqual(h.calls[1].body.requestId,h.calls[0].body.requestId);
});

test('late saved-status response after navigation cannot change the next yard',async t=>{
  const pending=deferred();let signal;
  const h=await mount({page:true,respond:()=>json({ok:false,error:'Uncertain'},503),readSaved:(_url,options)=>{signal=options.signal;return pending.promise;}});t.after(h.dispose);
  await h.click('Finish cotton');await h.submitForm();await h.click('Refresh saved status');await h.navigate('4331');assert.equal(signal.aborted,true);
  pending.resolve(json({ok:true,row:row({yard_status:'completed',outside_carrier_override_eligible:false})}));await h.flush();
  assert.doesNotMatch(h.text(),/already completed/);assert.equal(h.calls.length,1);
});


test('malformed conflict response still requires refresh and stale refresh callback cannot reopen a cancelled action',async t=>{
  const h=await mount({respond:()=>new Response('not JSON',{status:409})});t.after(h.dispose);
  await h.click('Process as Outside Carrier');assert.equal(h.button('Process as Outside Carrier').props.disabled,true);
  const staleRefresh=h.button('Refresh saved status').props.onClick;
  await h.click('Cancel');staleRefresh();await h.flush();assert.equal(h.button('Process as Outside Carrier').props.disabled,true);
  await h.click('Refresh saved status');assert.equal(h.button('Process as Outside Carrier').props.disabled,false);
});

test('saved-status timeout releases refresh controls and preserves uncertain request ID',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=await mount({respond:()=>json({ok:false,error:'Uncertain'},503),readSaved:(_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })});t.after(h.dispose);
  await h.click('Process as Outside Carrier');const requestId=h.calls[0].body.requestId;
  await h.click('Refresh saved status');assert.ok(h.button('Refreshing…'));t.mock.timers.tick(20000);await h.flush();
  assert.match(h.text(),/refresh timed out/);assert.equal(h.busyChanges.at(-1),false);assert.equal(h.button('Refresh saved status').props.disabled,false);
  await h.click('Process as Outside Carrier');assert.equal(h.calls[1].body.requestId,requestId);
});

// Automatic-flow coverage runs the actual line page. Compatibility tests above
// still exercise the retained manual component used by older deployed clients.
test('Finish cotton timeout requires a saved-status read and keeps its operation ID through navigation/remount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = new Map();
  const h = await mount({ page: true, storage, respond: (_body, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.submitForm();
  const id = h.calls[0].body.finishCottonRequestId;
  t.mock.timers.tick(30000); await h.flush();
  assert.match(h.text(), /status is uncertain/); assert.equal(h.button('Refresh saved status').props.disabled, false);
  await h.submitForm(); assert.equal(h.calls.length, 1);
  await h.click('Refresh saved status'); assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1);
  h.dispose();
  const remount = await mount({ page: true, storage }); t.after(remount.dispose);
  assert.equal(remount.calls.length, 0);
  await remount.click('Finish cotton'); await remount.submitForm();
  assert.equal(remount.calls[0].body.finishCottonRequestId, id);
});

test('failed, stale, partial and wrong-yard saved-status reads keep normal Finish cotton fenced', async t => {
  const invalid = [
    () => json({ ok: false, error: 'Unavailable' }, 503),
    () => json({ ok: true, row: row({ updated_at: '2026-10-12T10:00:00Z' }) }),
    () => json({ ok: true, row: row({ site_code: '4331' }) }),
    () => json({ ok: true, row: { id: row().id, terminal: 'HOU', site_code: '5300', updated_at: row().updated_at } }),
    () => json({ ok: true, row: row({ outside_carrier_override_eligible: undefined }) }),
    () => json({ ok: true, row: row({ yard_status: 'unexpected' }) }),
  ];
  for (const readSaved of invalid) {
    const h = await mount({ page: true, respond: () => json({ ok: false, error: 'Conflict' }, 409), readSaved }); t.after(h.dispose);
    await h.click('Finish cotton'); await h.submitForm();
    await h.click('Refresh saved status'); await h.submitForm();
    assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1);
    assert.equal(h.nodes(n => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, true);
    assert.match(h.text(), /Saved status could not be verified/);
    assert.equal(h.button('Refresh saved status').props.disabled, false);
  }
});

test('definite receiving validation errors preserve edits without forcing saved-status recovery', async t => {
  let attempt = 0;
  const h = await mount({ page: true, respond: () => ++attempt === 1
    ? json({ ok: false, error: 'Enter a warehouse location' }, 400)
    : json({ ok: true, row: row({ yard_status: 'completed', draft_status: 'outside_carrier', outside_carrier_override_at: '2026-10-13T11:00:00Z' }) }) }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.change('Warehouse location', ''); await h.submitForm();
  assert.equal(h.input('Warehouse location').props.value, '');
  assert.equal(h.nodes(n => n.type === 'button' && textOf(n) === 'Refresh saved status').length, 0);
  assert.equal(h.nodes(n => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, false);
  await h.change('Warehouse location', 'B2'); await h.submitForm();
  assert.equal(h.calls.length, 2); assert.equal(h.reads.length, 0);
  assert.equal(h.calls[1].body.cotton.warehouseLocation, 'B2');
  assert.equal(h.calls[1].body.finishCottonRequestId, h.calls[0].body.finishCottonRequestId);
});

test('lost automatic completion response recovers its one receipt by read only', async t => {
  const ids = new Set(); let receipts = 0;
  const saved = row({ updated_at: '2026-10-13T11:00:00Z', yard_status: 'completed', draft_status: 'outside_carrier',
    outside_carrier_override_at: '2026-10-13T11:00:00Z', outside_carrier_override_eligible: false });
  const h = await mount({ page: true, respond: body => {
    if (!ids.has(body.finishCottonRequestId)) { ids.add(body.finishCottonRequestId); receipts++; }
    throw new Error('Response lost after commit');
  }, readSaved: () => json({ ok: true, row: saved }) }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.submitForm(); assert.equal(receipts, 1);
  await h.click('Refresh saved status');
  assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1); assert.equal(receipts, 1);
  assert.match(h.text(), /No active domestic arrivals/); assert.match(h.text(), /SCM verification unresolved/);
});

test('newer saved receiving revision invalidates stale Finish handlers without submitting automatically', async t => {
  const newer = row({ updated_at: '2026-10-13T11:00:00Z', mcleod_lookup_attempt_id: '44444444-4444-4444-8444-444444444444', warehouse_location: 'B3' });
  const h = await mount({ page: true, respond: () => json({ ok: false, error: 'Uncertain' }, 503), readSaved: () => json({ ok: true, row: newer }) }); t.after(h.dispose);
  await h.click('Finish cotton'); const stale = h.nodes(n => n.type === 'form')[0].props.onSubmit;
  await h.submitForm(); await h.click('Refresh saved status');
  stale({ preventDefault() {} }); await h.flush(); assert.equal(h.calls.length, 1);
  await h.click('Finish cotton'); assert.equal(h.input('Warehouse location').props.value, 'B3'); await h.submitForm();
  assert.equal(h.calls[1].body.expectedUpdatedAt, newer.updated_at);
  assert.equal(h.calls[1].body.finishCottonRequestId, h.calls[0].body.finishCottonRequestId);
});

test('old saved-status handler cannot read or unlock a previous yard after navigation', async t => {
  const h = await mount({ page: true, respond: () => json({ ok: false, error: 'Uncertain' }, 503) }); t.after(h.dispose);
  await h.click('Finish cotton'); await h.submitForm();
  const stale = h.button('Refresh saved status').props.onClick;
  await h.navigate('4331'); stale(); await h.flush();
  assert.equal(h.reads.length, 0); assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.text(), /Saved status refreshed|Test Driver/);
});
