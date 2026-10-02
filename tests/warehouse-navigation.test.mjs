import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_LOCATIONS, validLocation, routeLocation, workspaceHref, availableCheckinViews, sectionForPath, safeOutboundReturn } from '../lib/warehouse/navigation.ts';

test('a deep link is authoritative over a conflicting location query', () => {
  assert.deepEqual(routeLocation('/warehouse/outbound/hou/4331/booking', new URLSearchParams('terminal=SAV&siteCode=246')), { terminal: 'HOU', siteCode: '4331' });
  assert.deepEqual(routeLocation('/inbound/checkin/sav/175', new URLSearchParams()), { terminal: 'SAV', siteCode: '175' });
});
test('all sites stays scoped to its terminal and an explicit all overrides remembered context', () => {
  assert.deepEqual(routeLocation('/warehouse/outbound', new URLSearchParams('warehouse=all&terminal=HOU')), { terminal: 'HOU', siteCode: 'all' });
  assert.deepEqual(routeLocation('/warehouse/outbound', new URLSearchParams('warehouse=all')), ALL_LOCATIONS);
  assert.equal(routeLocation('/warehouse', new URLSearchParams()), null);
});
test('obsolete and malformed locations never become operational site routes', () => {
  assert.deepEqual(validLocation({ terminal: 'SAV', siteCode: '1701' }), { terminal: 'SAV', siteCode: 'all' });
  assert.deepEqual(validLocation({ terminal: 'DAL', siteCode: '246' }), ALL_LOCATIONS);
  assert.deepEqual(validLocation(null), ALL_LOCATIONS);
  assert.equal(workspaceHref('checkins', { terminal: 'SAV', siteCode: 'all' }), '/inbound/checkin?terminal=SAV&warehouse=all');
});
test('1601 has freight and containers without cotton, and incompatible remembered tabs fall back safely', () => {
  const location = { terminal: 'SAV', siteCode: '1601' };
  assert.deepEqual(availableCheckinViews(location).map(x => x.key), ['line', 'domestic', 'containers']);
  assert.equal(workspaceHref('checkins', location, 'cotton'), '/warehouse/gate/sav/1601/domestic');
  assert.equal(workspaceHref('inventory', location), '/warehouse/inventory?terminal=SAV&siteCode=1601');
  assert.equal(workspaceHref('checkins', { terminal: 'SAV', siteCode: '246' }, 'containers'), '/inbound/checkin/sav/246');
});
test('changing locations preserves outbound filters without retaining old location or booking id', () => {
  const href = workspaceHref('outbound', { terminal: 'HOU', siteCode: '4331' }, 'cotton', 'terminal=SAV&siteCode=246&basis=erd&view=today&group=customer&q=Bunge&returnTo=bad');
  assert.equal(href, '/warehouse/outbound?terminal=HOU&siteCode=4331&basis=erd&view=today&group=customer&q=Bunge');
});
test('booking return restores the original all-sites scope and filters, allowing a cleared search', () => {
  assert.equal(safeOutboundReturn('/warehouse/outbound?warehouse=all&terminal=SAV&basis=erd&view=today&group=vessel&q='), '/warehouse/outbound?terminal=SAV&warehouse=all&basis=erd&view=today&group=vessel&q=');
  assert.equal(safeOutboundReturn('https://example.com'), null);
  assert.equal(safeOutboundReturn('//example.com'), null);
  assert.equal(safeOutboundReturn('/warehouse/outbound/evil'), null);
});
test('every warehouse screen belongs to a stable main section', () => {
  assert.equal(sectionForPath('/warehouse/outbound/sav/246/booking'), 'outbound');
  assert.equal(sectionForPath('/warehouse/gate/hou/4331/history'), 'history');
  assert.equal(sectionForPath('/inbound/history'), 'history');
  assert.equal(sectionForPath('/warehouse/gate/sav/1601/containers'), 'checkins');
  assert.equal(sectionForPath('/warehouse/inventory/sav/175'), 'inventory');
});
