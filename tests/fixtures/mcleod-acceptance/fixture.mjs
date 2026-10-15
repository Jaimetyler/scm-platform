import http from 'node:http';
import { pathToFileURL } from 'node:url';
export const FIXTURE_ID = 'scm-pr1-acceptance-v2-20261014';
export const TOKEN = 'scm-local-synthetic-only';
export const HOST = '127.0.0.1';
export const PORT = 4320;
const defaults = () => ({ '60136': 'cap', CURRENTFAIL: 'unavailable' });
const modes = new Set(['cap', 'unavailable', 'no_match', 'match']);
const compound = '81382 /49001932';
function order(id, reference, direction = 'delivery', cotton = true) {
  const movement = `${id}-MOVE`;
  return { id, status: 'A', __statusDescr: 'Available', revenue_code_id: 'MAIN', customer_id: 'SYNTHETIC',
    commodity_id: cotton ? 'COTTON' : 'LUMBER', pieces: cotton ? 88 : 1,
    blnum: direction === 'pickup' ? reference : cotton ? `${reference} 88 BALES` : 'SYNTHETIC-PICKUP', consignee_refno: direction === 'delivery' ? reference : 'SYNTHETIC-DESTINATION',
    movements: [{ id: movement, carrier_name: 'Synthetic Test Carrier', override_driver_nm: `Synthetic ${id}`, override_drvr_cell: '5555550100' }],
    stops: ['PU', 'SO'].map(type => ({ id: `${id}-${type}`, movement_id: movement, stop_type: type,
      sched_arrive_early: '20261013080000-0500', actual_arrival: '', actual_departure: '',
      location: { name: (direction === 'pickup' ? type === 'PU' : type === 'SO') ? 'SCM Houston 5300' : 'Synthetic Remote Warehouse', city_name: 'Houston', state: 'TX' } })) };
}
// 26 false substring hits precede the eligible whole-token order in descending IDs.
function denseOrders() {
  return ['pickup', 'delivery'].flatMap(direction => {
    const prefix = direction === 'pickup' ? 'PU' : 'DEL';
    return [...Array.from({length: 26}, (_, i) => order(`Z-DENSE-${prefix}-${String(i).padStart(2, '0')}`, '129510', direction, false)),
      order(`A-DENSE-${prefix}`, '2951 / 4500281026', direction, false)];
  });
}
// Acceptance-only cases. Deliberately complete search absence is distinct from
// malformed/partial upstream evidence. None of these names identify real freight.
function acceptanceOrders() {
  const fresh = order('SCM-FRESH-1014', 'SCM-FRESH-1014');
  fresh.stops[0].actual_arrival = '20261014060000-0500';
  fresh.stops[0].actual_departure = '20261014070000-0500';
  fresh.movements[0].carrier_name = 'Synthetic Fresh Acceptance Carrier';
  for (const stop of fresh.stops) stop.sched_arrive_early = '20261014080000-0500';
  const wrong = order('WRONG-YARD-1014', 'WRONG-YARD-1014', 'delivery', false);
  wrong.blnum = wrong.consignee_refno = 'WRONG-YARD-1014';
  for (const stop of wrong.stops) stop.location.name = 'SCM Houston 4331';
  const nonmain = order('NONMAIN-1014', 'NONMAIN-1014', 'delivery', false);
  nonmain.blnum = nonmain.consignee_refno = 'NONMAIN-1014';
  nonmain.revenue_code_id = 'SYNTHETIC-NONMAIN';
  const partial = order('PARTIAL-1014', 'PARTIAL-1014', 'delivery', false);
  partial.blnum = partial.consignee_refno = 'PARTIAL-1014';
  delete partial.stops; // An incomplete detail must never become an outside match.
  return [fresh, wrong, nonmain, partial];
}
export function createHandler({ hosted = false } = {}) {
  let scenarios = defaults();
  let records = [], writes = [], violations = [], sequence = 0;
  const fixed = [order('SCM-NORMAL', 'SCM-NORMAL'), ...denseOrders(), ...acceptanceOrders(), order('COMPOUND-DEL', compound, 'delivery', false), order('COMPOUND-PU', compound, 'pickup', false)];
  const allOrders = () => [...fixed, ...Object.entries(scenarios).filter(([, mode]) => mode === 'match').map(([ref]) => order(`MATCH-${ref}`, ref))];
  const record = (list, value) => { if (list.length >= 2000) throw Object.assign(new Error('Mock report capacity reached; reset before continuing'), { status: 507 }); list.push(value); };
  const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
  return async (req, res) => {
    const deadline = setTimeout(() => req.destroy(), 5000);
    const send = (status, data, plain = false) => { res.writeHead(status, { 'Content-Type': plain ? 'text/plain' : 'application/json', 'Cache-Control': 'no-store', 'X-SCM-Mock-Only': 'true', 'X-SCM-Fixture-ID': FIXTURE_ID }); res.end(plain ? data : JSON.stringify(data)); };
    try {
      if (!hosted && (req.socket.remoteAddress !== HOST || req.headers.host !== `${HOST}:${req.socket.localPort}`)) fail('Loopback host required', 403);
      if (req.headers.origin) fail('Browser-origin calls are not accepted; use the local harness', 403);
      if (req.headers.authorization !== `Bearer ${TOKEN}`) fail('Synthetic fixture token required', 401);
      if (!['GET', 'POST'].includes(req.method)) fail('Method not allowed', 405);
      if (!req.url.startsWith('/') || req.url.length > 4096) fail('Invalid local path', 400);
      const url = new URL(req.url, `http://${HOST}:${PORT}`);
      let size = 0, chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 4096) fail('Body exceeds 4096 bytes', 413); chunks.push(chunk); }
      const raw = Buffer.concat(chunks).toString('utf8');
      const control = url.pathname.startsWith('/__mock/');
      if (hosted && control && url.pathname !== '/__mock/health') fail('Stateful controls and reports are local-harness only', 409);
      if (hosted) console.info(JSON.stringify({mockOnly: true, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams)}));
      if (!control) record(records, { sequence: ++sequence, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
      const keys = [...url.searchParams.keys()];
      const only = allowed => { if (keys.some(k => !allowed.includes(k)) || new Set(keys).size !== keys.length) fail('Unexpected or duplicate query parameter'); };
      if (control) {
        only([]);
        if (req.method === 'GET' && ['/__mock/health', '/__mock/report'].includes(url.pathname)) {
          if (raw) fail('Unexpected body');
          return send(200, url.pathname.endsWith('health') ? { mockOnly: true, fixtureId: FIXTURE_ID, ready: true } : { mockOnly: true, scenarios, requests: records, writes, writeCount: writes.length, violations });
        }
        if (req.method === 'POST' && url.pathname === '/__mock/reset') {
          if (raw && raw !== '{}') fail('Reset body must be empty or {}');
          scenarios = defaults(); records = []; writes = []; violations = []; sequence = 0; return send(200, { mockOnly: true, scenarios });
        }
        if (req.method === 'POST' && url.pathname === '/__mock/scenario') {
          let body; try { body = JSON.parse(raw); } catch { fail('JSON body required'); }
          if (!body || typeof body !== 'object' || Object.keys(body).sort().join(',') !== 'mode,reference' || !Object.hasOwn(scenarios, body.reference) || !modes.has(body.mode)) fail('Expected known reference 60136/CURRENTFAIL and mode cap/unavailable/no_match/match');
          scenarios[body.reference] = body.mode; return send(200, { mockOnly: true, scenarios });
        }
        fail('Unknown mock control endpoint', 404);
      }
      if (raw) fail('Vendor fixture endpoints do not accept bodies');
      if (req.method === 'GET' && url.pathname === '/orders/search') {
        only(['orders.id', 'orders.blnum', 'orders.consignee_refno', 'customer.id', 'recordLength', 'recordOffset']);
        const length = Number(url.searchParams.get('recordLength')), offset = Number(url.searchParams.get('recordOffset') || '0');
        if (![2, 5, 200, 500].includes(length) || !Number.isInteger(offset) || offset < 0 || offset > 100 || (length !== 5 && offset !== 0)) fail('Unsupported fixture pagination');
        const customer = url.searchParams.get('customer.id');
        if (customer !== null && customer !== 'SYNTHETIC') fail('Unknown fixture customer');
        const selectors = ['orders.id', 'orders.blnum', 'orders.consignee_refno'].filter(k => url.searchParams.has(k));
        if (!selectors.length) {
          if (customer !== 'SYNTHETIC' || length !== 500) fail('Unknown batch fixture');
          return send(200, allOrders());
        }
        if (selectors.length !== 1) fail('One fixture selector required');
        const field = selectors[0], pattern = url.searchParams.get(field);
        if (field === 'orders.id') {
          if (length !== 2 || !['60136', 'CURRENTFAIL', '81382', '49001932', '2951', '4500281026', 'OUTSIDE-NONE-1014', 'DENSE-CAP-2951', ...allOrders().map(o => o.id)].includes(pattern)) fail('Unknown exact-ID fixture');
          return send(200, allOrders().filter(o => o.id === pattern));
        }
        if (![5, 200].includes(length) || !/^\*[A-Z0-9* /-]+\*$/.test(pattern)) fail('Unsupported fixture reference query');
        const normalized = pattern.replace(/[^A-Z0-9]/g, '');
        const known = ['60136', 'CURRENTFAIL', 'SCMNORMAL', '81382', '49001932', '8138249001932', 'COMPOUNDDEL', 'COMPOUNDPU', '2951', '4500281026', '29514500281026', 'OUTSIDENONE1014', 'SCMFRESH1014', 'WRONGYARD1014', 'NONMAIN1014', 'PARTIAL1014', 'DENSECAP2951'];
        if (!known.includes(normalized)) fail('Unknown reference fixture');
        const mode = normalized === 'DENSECAP2951' ? 'cap' : scenarios[normalized];
        if (mode === 'unavailable') return send(503, { mockOnly: true, fixtureId: FIXTURE_ID, error: 'Synthetic lookup unavailable' });
        if (mode === 'cap') return send(200, Array.from({ length }, (_, i) => ({ id: `CAP-${String(offset + i).padStart(4, '0')}`, revenue_code_id: 'MAIN', customer_id: 'SYNTHETIC', consignee_refno: 'OTHER', blnum: 'OTHER 88 BALES' })));
        const regex = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
        const rows = allOrders().filter(o => regex.test(o[field.slice(7)])).sort((a, b) => a.id < b.id ? 1 : -1);
        return send(200, rows.slice(offset, offset + length));
      }
      if (req.method === 'GET' && /^\/orders\/[A-Z0-9-]+$/.test(url.pathname)) {
        only([]); const found = allOrders().find(o => o.id === url.pathname.slice(8));
        if (!found) fail('Unknown order fixture', 404); return send(200, found);
      }
      if (req.method === 'POST' && /^\/carrierDispatch\/clearStop\/[A-Z0-9-]+$/.test(url.pathname)) {
        only(['arrivalDate', 'departureDate']);
        const stopId = url.pathname.split('/').pop();
        const stop = allOrders().flatMap(o => o.stops ?? []).find(s => s.id === stopId);
        if (!stop || !/^SCM-NORMAL-|^SCM-FRESH-1014-SO$|^MATCH-/.test(stopId)) fail('Unknown or read-only stop fixture');
        const arrivalDate = url.searchParams.get('arrivalDate'), departureDate = url.searchParams.get('departureDate');
        if (keys.length !== 2 || !/^\d{14}[+-]\d{4}$/.test(arrivalDate) || !/^\d{14}[+-]\d{4}$/.test(departureDate)) fail('Explicit McLeod-shaped actuals required');
        record(writes, { sequence, stopId, arrivalDate, departureDate, mockOnly: true });
        if (hosted) console.info(JSON.stringify({mockOnly: true, event: 'simulated_clear_stop', stopId, arrivalDate, departureDate}));
        return send(200, 'OK', true);
      }
      fail('Unknown fixture endpoint or method', 404);
    } catch (error) {
      if (violations.length < 2000) violations.push({ method: req.method, path: (req.url || '').split('?')[0], error: error.message });
      send(error.status || 500, { mockOnly: true, fixtureId: FIXTURE_ID, error: error.message });
    } finally { clearTimeout(deadline); }
  };
}
export function createStub() {
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, createHandler());
  server.maxConnections = 16;
  server.setTimeout(5000, socket => socket.destroy());
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const server = createStub();
  server.listen(PORT, HOST, () => console.log(`Synthetic McLeod fixture listening only on http://${HOST}:${PORT}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
