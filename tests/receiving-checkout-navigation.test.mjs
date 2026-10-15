import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mergePollingRows } from '../lib/polling/merge-rows.ts';

// Run the actual line page and review component with read-only URL navigation.
// Fetch and browser boundaries are mocked; no external services are contacted.
const reviewPath = '../components/warehouse/OutsideCarrierReview.tsx';
const linePath = '../app/warehouse/gate/[terminal]/[siteCode]/line/page.tsx';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const json = (body, status = 200) => Response.json(body, { status });
const row = (extra = {}) => ({ id: '11111111-1111-4111-8111-111111111111', updated_at: '2026-10-13T10:00:00Z',
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
async function mount({ page = true, initialRow = row(), search = "", canWrite = true, respond = () => json({ ok: true,
  row: row({ yard_status: 'completed', outside_carrier_override_at: '2026-10-13T11:00:00Z', outside_carrier_override_eligible: false }) }) } = {}) {
  const instances = new Map(), calls = [], completed = [], busyChanges = [], openChanges = [], polling = [];
  let current, cursor, dirty = true, tree, effects = [], serverRows = [initialRow], params = { terminal: 'HOU', siteCode: '5300' };
  let props, disposed = false, root;
  const scrolled = [], focused = [], events = new Map();
  const browser = { location: { search }, confirm: () => true,
    addEventListener: (event, fn) => events.set(event, fn), removeEventListener: event => events.delete(event) };
  const document = { getElementById: id => all(tree, n => n.props?.id === id).length ? {
    scrollIntoView: () => scrolled.push(id), focus: () => focused.push(id) } : null };
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
    if (!options.method) return json({ ok: true, rows: serverRows });
    const call = { url, options, body: JSON.parse(options.body) }; calls.push(call);
    const response = await respond(call.body, call.options, calls);
    const result = await response.clone().json();
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
    new Function('require', 'module', 'exports', 'fetch', 'window', 'document', compile(path))(
      name => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; }, module, module.exports, fetch, browser, document);
    return module.exports;
  };
  const review = load(reviewPath); modules['@/components/warehouse/OutsideCarrierReview'] = review;
  root = page ? load(linePath).default : review.default;
  props = page ? {} : { row: initialRow, terminal: 'HOU', siteCode: '5300', canWrite, busy: false,
    onRetry: () => calls.push({ retry: true }), onBusy: value => busyChanges.push(value), onOpenChange: value => openChanges.push(value),
    onComplete: (...args) => completed.push(args) };
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
    calls, completed, busyChanges, openChanges, polling, review, flush, scrolled, focused,
    async history(search) { browser.location.search = search; events.get('popstate')?.(); await flush(); },
    async server(next) { serverRows = next; await polling.at(-1).load(new AbortController().signal); await flush(); },
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
test('receiving navigation preserves the mounted autosave form and uses only a fixed yard route', () => {
  const source = readFileSync(new URL('../app/inbound/checkin/[terminal]/[siteCode]/page.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('{canWrite && row.processing_error');
  const link = source.slice(start, source.indexOf('{cottonShortage(row) && <button', start));
  assert.match(link, /row\.draft_status === "failed"/);
  assert.match(link, /test\(row\.id\)/);
  assert.match(link, /\/warehouse\/gate\/\$\{site\.terminalSlug\}\/\$\{site\.siteCode\}\/line\?arrival=/);
  assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  assert.match(link, /Finish saving edits, then refresh checkout/);
  assert.doesNotMatch(link, /onClick|saveRowSnapshot|setRows|window\.location/);
  assert.match(source, /expectedUpdatedAt: row\.updated_at/);
});

test('arrival link highlights and focuses the exact saved row without opening or submitting confirmation', async t => {
  const h = await mount({ search: `?arrival=${row().id}&returnTo=https://evil.invalid` }); t.after(h.dispose);
  assert.deepEqual(h.scrolled, [`arrival-${row().id}`]);
  assert.deepEqual(h.focused, h.scrolled);
  assert.match(h.text(), /requested arrival is highlighted/);
  assert.ok(h.nodes(n => n.props?.['aria-label'] === 'Requested arrival').length === 1);
  assert.ok(h.nodes(n => n.props?.href === '/inbound/checkin/hou/5300').length === 1);
  assert.equal(h.nodes(n => String(n.props?.href).includes('evil.invalid')).length, 0);
  assert.equal(h.calls.length, 0);
});

test('malformed and repeated arrival IDs do not select a row or cause requests with URL actions', async t => {
  for (const search of ['?arrival=../../other', '?arrival=', `?arrival=${row().id}&arrival=${row().id}`]) {
    const h = await mount({ search }); t.after(h.dispose);
    assert.match(h.text(), /Invalid arrival link/);
    assert.equal(h.scrolled.length, 0); assert.equal(h.calls.length, 0);
  }
});

test('unknown or different-yard arrival does not fall back to another row', async t => {
  const h = await mount({ search: '?arrival=99999999-9999-4999-8999-999999999999&action=outside_carrier' }); t.after(h.dispose);
  assert.match(h.text(), /not in this yard/);
  assert.equal(h.scrolled.length, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.nodes(n => n.props?.['aria-label'] === 'Requested arrival').length, 0);
});

test('completed deep link preserves the unresolved outside marker and cannot re-checkout', async t => {
  const h = await mount({ search: `?arrival=${row().id}`, initialRow: row({ yard_status: 'completed',
    outside_carrier_override_at: '2026-10-13T11:00:00Z', outside_carrier_override_reason: 'Carrier verified at gate',
    outside_carrier_override_eligible: false }) }); t.after(h.dispose);
  assert.match(h.text(), /cannot be checked out again/);
  assert.match(h.text(), /Completed movements · SCM verification unresolved/);
  assert.match(h.text(), /Carrier verified at gate/);
  assert.equal(h.nodes(n => n.type === 'button' && /Check out|Process as Outside Carrier/.test(textOf(n))).length, 0);
  assert.deepEqual(h.scrolled, [`arrival-${row().id}`]); assert.equal(h.calls.length, 0);
});

test('read-only deep link retains disabled actions; history and yard navigation clear stale selection', async t => {
  const h = await mount({ search: `?arrival=${row().id}`, canWrite: false }); t.after(h.dispose);
  assert.equal(h.nodes(n => n.type === 'button' && /Check out|Process as Outside Carrier|Finish cotton/.test(textOf(n)) && !n.props.disabled).length, 0);
  await h.history('?arrival=invalid'); assert.match(h.text(), /Invalid arrival link/);
  await h.history(`?arrival=${row().id}`); assert.match(h.text(), /requested arrival is highlighted/);
  await h.navigate('4331'); assert.match(h.text(), /not in this yard/);
  assert.ok(h.nodes(n => n.props?.href === '/inbound/checkin/hou/4331').length === 1);
  assert.equal(h.calls.length, 0);
});

test('a refreshed completed arrival replaces the active target without URL-driven writes', async t => {
  const h = await mount({ search: `?arrival=${row().id}` }); t.after(h.dispose);
  await h.server([row({ updated_at: '2026-10-13T12:00:00Z', yard_status: 'completed', outside_carrier_override_eligible: false })]);
  assert.match(h.text(), /cannot be checked out again/);
  assert.equal(h.nodes(n => n.props?.['aria-label'] === 'Requested arrival').length, 0);
  assert.equal(h.calls.length, 0);
});
