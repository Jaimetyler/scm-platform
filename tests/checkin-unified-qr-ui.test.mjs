import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual page and its event handlers with a tiny hook renderer.
// Network, location, and React scheduling are controlled boundaries; no live I/O.
const path = new URL('../app/gate/check-in/[token]/page.tsx', import.meta.url);
const source = ts.transpileModule(readFileSync(path, 'utf8'), {
  fileName: path.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const label = 'Pickup / delivery reference or SCM order number';
const site = { terminal: 'HOU', siteCode: '5300', siteName: 'Houston 5300', materials: ['cotton', 'lumber', 'other'], containers: true };
const candidate = (extra = {}) => ({ orderId: '0824528', stopId: 'STOP-1', carrierName: 'Real Carrier', driverName: 'Pat Driver', driverPhoneLast4: '0100', selectable: true, completion: null, ...extra });
const matches = (...items) => ({ ok: true, status: 'matches', allowUnmatched: false, selectionRequired: items.filter(item => !item.completion).length > 1, matches: items });
const details = (extra = {}) => ({ ok: true, stopId: 'STOP-1', direction: 'pickup', reference: 'CANONICAL-REF', materialType: 'cotton', mark: 'TESTMARK', baleCount: '88', carrierName: 'Real Carrier', driverName: 'Pat Driver', driverPhone: '555-999-0100', destination: 'Warehouse', ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const json = (body, status = 200) => Response.json(body, { status });
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
function all(node, predicate) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
function expand(node) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}
async function mount(respond = body => body.action === 'lookupReference' ? json(matches(candidate())) : json(details()), submitResponse = () => json({ ok: true })) {
  const slots = [], calls = [];
  let cursor = 0, dirty = true, tree, pendingEffects = [], token = 'gate-one';
  let geo = resolve => resolve({ coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: Date.now() });
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const modules = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/navigation': { useParams: () => ({ token }) },
    '@/components/warehouse/CompletedOrderNotice': { default: props => jsx('aside', { children: props.completion.message }) },
  };
  const module = { exports: {} };
  const fetch = async (url, options = {}) => {
    if (!options.method) return json({ ok: true, site });
    const body = options.body instanceof FormData ? options.body : JSON.parse(options.body);
    calls.push({ url, options, body });
    return body instanceof FormData ? submitResponse(body, options, calls) : respond(body, options, calls);
  };
  new Function('require', 'module', 'exports', 'fetch', 'navigator', 'window', source)(
    name => { assert.ok(name in modules, `unexpected dependency: ${name}`); return modules[name]; }, module, module.exports,
    fetch, { geolocation: { getCurrentPosition: (resolve, reject) => geo(resolve, reject) } },
    { localStorage: { getItem: () => null, setItem() {} } },
  );
  function render() {
    cursor = 0; dirty = false; pendingEffects = [];
    tree = expand(module.exports.default());
    pendingEffects.forEach(effect => effect());
  }
  async function flush() { for (let i = 0; i < 30; i++) { if (dirty) render(); await Promise.resolve(); } if (dirty) render(); }
  const api = {
    calls, flush,
    get tree() { return tree; },
    text: () => textOf(tree),
    nodes: predicate => all(tree, predicate),
    button(text) { const result = all(tree, node => node.type === 'button' && textOf(node) === text)[0]; assert.ok(result, `missing button ${text}`); return result; },
    input(text) {
      const element = all(tree, node => node.type === 'label' && typeof node.props.children?.[0] === 'string' && node.props.children[0] === text)[0];
      assert.ok(element, `missing label ${text}`);
      return all(element, node => node.type === 'input' || node.type === 'select')[0];
    },
    async change(text, value) { api.input(text).props.onChange({ target: { value } }); await flush(); },
    async click(text) { const button = api.button(text); assert.notEqual(button.props.disabled, true, `disabled button ${text}`); button.props.onClick(); await flush(); },
    async submit() { const result = all(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await flush(); await result; await flush(); },
    get submitButton() { return all(tree, node => node.type === 'button' && node.props.type === 'submit')[0]; },
    get formSubmit() { return all(tree, node => node.type === 'form')[0].props.onSubmit; },
    setGeo(next) { geo = next; },
    async setToken(next) { token = next; dirty = true; await flush(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
  await flush();
  await api.click('Domestic FreightPickup or delivery');
  await api.change('Pickup or delivery? *', 'pickup');
  await api.change(label, '0824528');
  return api;
}

test('QR renders one exact-label input, retains pickup/delivery and cotton fields, and has no blur lookup', async t => {
  const h = await mount(); t.after(h.dispose);
  assert.equal(h.nodes(node => node.type === 'input' && node.props.value === '0824528').length, 1);
  assert.equal(h.input(label).props.required, true);
  assert.equal(h.input(label).props.onBlur, undefined);
  assert.equal(h.nodes(node => node.type === 'details').length, 0);
  assert.doesNotMatch(h.text(), /Trip Contract|instead\?/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.submitButton.props.disabled, true);
  await h.change('Material *', 'cotton');
  assert.ok(h.input('Mark *')); assert.ok(h.input('Bale count on BOL *'));
  await h.change('Pickup or delivery? *', 'delivery');
  assert.ok(h.input('Bales on truck (if different from BOL)'));
});

test('unique SCM ID or reference uses one lookup flow, preserves typed input and entered phone, and submits actual order/stop separately', async t => {
  for (const input of ['0824528', 'Ref-lowerCase']) {
    const h = await mount(); t.after(h.dispose);
    await h.change(label, input);
    await h.change('Mobile number *', '555-123-8888');
    await h.click('Find my load');
    assert.deepEqual(h.calls.map(call => call.body.action), ['lookupReference', 'lookupOrder']);
    assert.equal(h.calls[0].body.referenceNumber, input);
    assert.equal(h.calls[1].body.driverLookupInput, input);
    assert.equal(h.input(label).props.value, input);
    assert.equal(h.input('Mobile number *').props.value, '555-123-8888');
    assert.equal(h.input('Pickup or delivery? *').props.disabled, undefined);
    assert.equal(h.submitButton.props.disabled, false);
    await h.submit();
    const body = h.calls.at(-1).body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get('driverLookupInput'), input);
    assert.equal(body.get('referenceNumber'), input);
    assert.equal(body.get('orderId'), '0824528');
    assert.equal(body.get('selectedStopId'), 'STOP-1');
    assert.equal(body.get('driverPhone'), '555-123-8888');
    assert.equal(body.get('mark'), 'TESTMARK');
    assert.equal(body.get('bolBaleCount'), '88');
  }
});

test('ambiguous loads require company plus driver choice, never company grouping or customer/order labels', async t => {
  const first = candidate({ customer: 'PRIVATE CUSTOMER', orderId: 'FIRST', driverName: 'Pat Driver' });
  const second = candidate({ customer: 'OTHER CUSTOMER', orderId: 'SECOND', stopId: 'STOP-2', driverName: 'Sam Driver', driverPhoneLast4: '0200' });
  const h = await mount(body => body.action === 'lookupReference' ? json(matches(first, second)) : json(details({ stopId: body.selectedStopId }))); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.calls.length, 1);
  assert.match(h.text(), /Real CarrierPat Driver · Phone ending 0100/);
  assert.match(h.text(), /Real CarrierSam Driver · Phone ending 0200/);
  assert.doesNotMatch(h.text(), /PRIVATE CUSTOMER|OTHER CUSTOMER|FIRST|SECOND|555-999/);
  assert.equal(h.submitButton.props.disabled, true);
  await h.click('Real CarrierSam Driver · Phone ending 0200');
  assert.equal(h.calls[1].body.orderId, 'SECOND');
  assert.equal(h.calls[1].body.selectedStopId, 'STOP-2');
  assert.equal(h.submitButton.props.disabled, false);
  assert.equal(h.input('Mobile number *').props.value, '');
});

test('indistinguishable identities and backing out never authorize an unmatched submission', async t => {
  const h = await mount(() => json(matches(candidate({ selectable: false }), candidate({ orderId: 'OTHER', stopId: 'STOP-2', selectable: false })))); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.button('Real CarrierPat Driver · Phone ending 0100').props.disabled, true);
  h.button('Real CarrierPat Driver · Phone ending 0100').props.onClick(); await h.flush();
  assert.equal(h.calls.length, 1);
  assert.match(h.text(), /same or missing company and driver details/);
  await h.click('Go back / speak with warehouse staff');
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.submitButton.props.disabled, true);
});

test('only explicit complete no-match allows paperwork submission; errors, wrong-yard, partial, and closed results stay blocked', async t => {
  const cases = [
    { body: { ok: true, status: 'no_match', allowUnmatched: true, matches: [] }, enabled: true },
    { body: { ok: true, status: 'no_match', allowUnmatched: false, matches: [] } },
    { body: { ok: true, matches: [] } },
    { body: { ok: true, status: 'no_match', allowUnmatched: true, incomplete: true, matches: [] } },
    { body: { ok: false, error: 'Wrong yard' }, status: 409 },
    { body: { ok: false, error: 'One lookup failed. Try again.' }, status: 503 },
    { body: matches(candidate({ completion: { message: 'Pickup already completed in McLeod' } })) },
  ];
  for (const item of cases) {
    const h = await mount(() => json(item.body, item.status)); t.after(h.dispose);
    await h.click('Find my load');
    assert.equal(h.submitButton.props.disabled, !item.enabled);
    if (item.enabled) {
      await h.change('Driver name *', 'Entered Driver');
      await h.submit();
      assert.equal(h.calls.at(-1).body.get('orderId'), '');
      assert.equal(h.calls.at(-1).body.get('selectedStopId'), '');
    } else {
      await h.submit();
      assert.equal(h.calls.length, 1);
      assert.doesNotMatch(h.text(), /Continue with the details from your paperwork/);
    }
  }
});

test('input or direction changes abort lookup and suppress stale responses and automatic selection', async t => {
  for (const field of [label, 'Pickup or delivery? *']) {
    const pending = deferred();
    const h = await mount(() => pending.promise); t.after(h.dispose);
    await h.click('Find my load');
    const previous = h.calls[0];
    await h.change(field, field === label ? 'NewReference' : 'delivery');
    assert.equal(previous.options.signal.aborted, true);
    pending.resolve(json(matches(candidate()))); await h.flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.submitButton.props.disabled, true);
    assert.equal(h.input('Trucking company *').props.value, '');
    assert.doesNotMatch(h.text(), /SCM order found/);
  }
});

test('matched input edits synchronously block old submit closures, clear auto-filled selection, and retain manual corrections', async t => {
  const h = await mount(); t.after(h.dispose);
  await h.click('Find my load');
  await h.change('Driver name *', 'My correction');
  await h.change('Mobile number *', '555-123-1234');
  const previousSubmit = h.formSubmit;
  h.input(label).props.onChange({ target: { value: 'NewReference' } });
  await previousSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.input('Trucking company *').props.value, '');
  assert.equal(h.input('Material *').props.value, '');
  assert.equal(h.input('Driver name *').props.value, 'My correction');
  assert.equal(h.input('Mobile number *').props.value, '555-123-1234');
  assert.equal(h.submitButton.props.disabled, true);
});

test('lookup geolocation and selection requests cannot race a submit or newer direction', async t => {
  const h = await mount(); t.after(h.dispose);
  let location;
  h.setGeo(resolve => { location = resolve; });
  await h.click('Find my load');
  await h.submit();
  assert.equal(h.calls.length, 0);
  await h.change('Pickup or delivery? *', 'delivery');
  location({ coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: Date.now() }); await h.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.submitButton.props.disabled, true);
});

test('late selected-order details cannot overwrite newer input or authorize submission', async t => {
  const pending = deferred();
  const h = await mount(body => body.action === 'lookupReference' ? json(matches(candidate())) : pending.promise); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.calls.length, 2);
  await h.change(label, 'NewReference');
  assert.equal(h.calls[1].options.signal.aborted, true);
  pending.resolve(json(details())); await h.flush();
  assert.equal(h.input(label).props.value, 'NewReference');
  assert.equal(h.input('Driver name *').props.value, '');
  assert.equal(h.submitButton.props.disabled, true);
});

test('token navigation discards pending lookup and restores the untouched new gate form', async t => {
  const pending = deferred();
  const h = await mount(() => pending.promise); t.after(h.dispose);
  await h.click('Find my load');
  await h.setToken('gate-two');
  assert.equal(h.calls[0].options.signal.aborted, true);
  pending.resolve(json(matches(candidate()))); await h.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.nodes(node => node.type === 'input').length, 0);
  assert.doesNotMatch(h.text(), /SCM order found/);
});

test('repeating a matched lookup clears prior automated details even if the new result is no-match', async t => {
  let searches = 0;
  const h = await mount(body => body.action === 'lookupReference'
    ? json(++searches === 1 ? matches(candidate()) : { ok: true, status: 'no_match', allowUnmatched: true, matches: [] })
    : json(details())); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.input('Trucking company *').props.value, 'Real Carrier');
  await h.click('Find my load');
  assert.equal(h.input('Trucking company *').props.value, '');
  assert.equal(h.input('Driver name *').props.value, '');
  assert.equal(h.input('Material *').props.value, '');
  assert.equal(h.submitButton.props.disabled, false);
  await h.submit();
  assert.equal(h.calls.at(-1).body.get('orderId'), '');
  assert.equal(h.calls.at(-1).body.get('selectedStopId'), '');
});

test('old chooser callbacks cannot select or dismiss a newer search with matching order IDs', async t => {
  const h = await mount(body => body.action === 'lookupReference'
    ? json(matches(candidate(), candidate({ orderId: 'OTHER', stopId: 'STOP-2', driverName: 'Sam Driver' })))
    : json(details())); t.after(h.dispose);
  await h.click('Find my load');
  const oldChoice = h.button('Real CarrierPat Driver · Phone ending 0100');
  const oldBack = h.button('Go back / speak with warehouse staff');
  await h.click('Go back / speak with warehouse staff');
  await h.change(label, 'AnotherReference');
  await h.click('Find my load');
  oldChoice.props.onClick(); oldBack.props.onClick(); await h.flush();
  assert.equal(h.calls.length, 2);
  assert.ok(h.nodes(node => node.props?.role === 'dialog').length);
  assert.equal(h.submitButton.props.disabled, true);
});

test('a completion returned during final lookup always blocks even with an inconsistent success flag', async t => {
  const h = await mount(body => body.action === 'lookupReference'
    ? json(matches(candidate()))
    : json(details({ completion: { message: 'Pickup already completed in McLeod' } }))); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.submitButton.props.disabled, true);
  assert.match(h.text(), /Pickup already completed in McLeod/);
  await h.submit();
  assert.equal(h.calls.length, 2);
});

test('company choices display at most the last four phone digits if the response is overbroad', async t => {
  const h = await mount(() => json(matches(candidate({ driverPhoneLast4: '+1 (555) 999-0100' }), candidate({ orderId: 'OTHER', stopId: 'STOP-2', driverName: 'Sam Driver' })))); t.after(h.dispose);
  await h.click('Find my load');
  assert.match(h.text(), /Phone ending 0100/);
  assert.doesNotMatch(h.text(), /555|999/);
});

test('container check-in remains independent of domestic lookup authorization', async t => {
  const h = await mount(); t.after(h.dispose);
  await h.click('Container / DrayageJoin the driver line');
  await h.change('Driver name *', 'Container Driver');
  assert.equal(h.submitButton.props.disabled, false);
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.get('checkinType'), 'container');
  assert.equal(h.calls[0].body.get('orderId'), '');
});


test('explicit selection is false for automatic unique matches and true only after a deliberate candidate click', async t => {
  const auto = await mount(); t.after(auto.dispose);
  await auto.click('Find my load');
  assert.equal(auto.calls[1].body.explicitSelection, false);
  await auto.submit();
  assert.equal(auto.calls.at(-1).body.get('explicitSelection'), 'false');

  const chosen = await mount(body => body.action === 'lookupReference'
    ? json(matches(candidate(), candidate({ orderId: 'OTHER', stopId: 'STOP-2', driverName: 'Sam Driver' })))
    : json(details())); t.after(chosen.dispose);
  await chosen.click('Find my load');
  await chosen.click('Real CarrierPat Driver · Phone ending 0100');
  assert.equal(chosen.calls[1].body.explicitSelection, true);
  await chosen.submit();
  assert.equal(chosen.calls.at(-1).body.get('explicitSelection'), 'true');
});

test('fresh ambiguity during selected-order lookup blocks readiness and asks for a new lookup', async t => {
  const h = await mount(body => body.action === 'lookupReference'
    ? json(matches(candidate()))
    : json({ ok: false, code: 'SELECTION_REQUIRED', error: 'More than one load now matches.' }, 409)); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.submitButton.props.disabled, true);
  assert.match(h.text(), /Select Find my load and confirm your trucking company and driver/);
  await h.submit();
  assert.equal(h.calls.length, 2);
});

test('fresh ambiguity during submit clears previous readiness and prevents repeated submit loops', async t => {
  const h = await mount(undefined, () => json({ ok: false, code: 'SELECTION_REQUIRED', error: 'More than one load now matches.' }, 409)); t.after(h.dispose);
  await h.click('Find my load');
  assert.equal(h.submitButton.props.disabled, false);
  await h.submit();
  assert.equal(h.submitButton.props.disabled, true);
  assert.equal(h.input('Trucking company *').props.value, '');
  assert.equal(h.input(label).props.value, '0824528');
  assert.match(h.text(), /Select Find my load and confirm your trucking company and driver/);
  await h.submit();
  assert.equal(h.calls.length, 3);
});

test('editing a deliberate selection resets explicit selection before a subsequent unique match', async t => {
  let searches = 0;
  const h = await mount(body => body.action === 'lookupReference'
    ? json(++searches === 1 ? matches(candidate(), candidate({ orderId: 'OTHER', stopId: 'STOP-2', driverName: 'Sam Driver' })) : matches(candidate()))
    : json(details())); t.after(h.dispose);
  await h.click('Find my load');
  await h.click('Real CarrierPat Driver · Phone ending 0100');
  assert.equal(h.calls[1].body.explicitSelection, true);
  await h.change(label, 'AnotherReference');
  await h.click('Find my load');
  assert.equal(h.calls[3].body.explicitSelection, false);
  await h.submit();
  assert.equal(h.calls.at(-1).body.get('explicitSelection'), 'false');
});
