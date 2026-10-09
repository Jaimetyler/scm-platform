import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisiblePoller } from '../lib/polling/visible-poller.ts';
const settle = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };

test('polling coalesces manual/periodic reads, schedules after completion, and suppresses hidden work', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let visible=true,calls=0,finish,signal,success=0;
  const poll=createVisiblePoller({intervalMs:1000,random:()=>.5,visible:()=>visible,onSuccess:()=>success++,load:s=>{
    calls++;signal=s;return new Promise(r=>{finish=r;});
  }});
  const first=poll.refresh();const second=poll.refresh();assert.equal(first,second);
  await settle();assert.equal(calls,1);t.mock.timers.tick(1500);await settle();assert.equal(calls,1);
  finish();await first;assert.equal(success,1);t.mock.timers.tick(999);await settle();assert.equal(calls,1);
  visible=false;poll.visibilityChanged();t.mock.timers.tick(5000);await settle();assert.equal(calls,1);
  visible=true;poll.visibilityChanged();await settle();assert.equal(calls,2);
  poll.dispose();assert.equal(signal.aborted,true);finish();await settle();assert.equal(success,1);
});

test('errors back off and successful recovery resets delay; hidden return is immediate', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let calls=0,visible=true;
  const poll=createVisiblePoller({intervalMs:1000,random:()=>.5,visible:()=>visible,load:async()=>{
    if (++calls<3) throw new Error('outage');
  }});
  await poll.refresh();t.mock.timers.tick(1999);await settle();assert.equal(calls,1);
  t.mock.timers.tick(1);await settle();assert.equal(calls,2);
  t.mock.timers.tick(3999);await settle();assert.equal(calls,2);
  t.mock.timers.tick(1);await settle();assert.equal(calls,3);
  t.mock.timers.tick(1000);await settle();assert.equal(calls,4);
  visible=false;poll.visibilityChanged();visible=true;poll.visibilityChanged();await settle();assert.equal(calls,5);
  poll.dispose();
});

test('abort deadlines, disposal and visibility transitions discard stale completion',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let signal,done,success=0,visible=true;
  const poll=createVisiblePoller({intervalMs:1000,timeoutMs:2000,random:()=>.5,visible:()=>visible,onSuccess:()=>success++,load:s=>{
    signal=s;return new Promise(r=>{done=r;});
  }});
  const request=poll.refresh();await settle();t.mock.timers.tick(2000);assert.equal(signal.aborted,true);
  done();await request;assert.equal(success,0);
  visible=false;poll.visibilityChanged();await poll.refresh();assert.equal(success,0);poll.dispose();
});


import { mergePollingRows } from '../lib/polling/merge-rows.ts';
import { readFileSync } from 'node:fs';
const row=(id,updated_at='1',note='server')=>({id,updated_at,note});

test('refresh preserves dirty rows and midnight drafts, and never replaces a newer save',()=>{
 const original=[row('edited'),row('saved'),row('old-day')];
 const current=[row('edited','1','typing'),row('saved','3','just saved'),row('old-day','1','draft'),row('local-new','','typing')];
 const incoming=[row('edited','2'),row('saved','2')];
 const actual=mergePollingRows(current,incoming,original,new Set(['edited','old-day']));
 assert.deepEqual(actual,current);
});

test('refresh preserves newly created rows, suppresses late deleted rows and removes clean expired rows',()=>{
 const before=[row('deleted'),row('expired'),row('unchanged')];
 const current=[row('expired'),row('unchanged'),row('new','2')];
 assert.deepEqual(mergePollingRows(current,[row('deleted'),row('unchanged','2')],before,new Set()),[row('unchanged','2'),row('new','2')]);
});

test('all four operational lists wire abortable polling and scope resets without pagination',()=>{
 for(const path of [
  'app/warehouse/gate/[terminal]/[siteCode]/line/page.tsx',
  'app/warehouse/gate/[terminal]/[siteCode]/domestic/page.tsx',
  'app/warehouse/gate/[terminal]/[siteCode]/containers/page.tsx',
  'app/inbound/checkin/[terminal]/[siteCode]/page.tsx',
 ]) {
  const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  assert.match(source,/useVisiblePolling\(/,path);
  assert.match(source,/cache: "no-store", signal/,path);
  assert.match(source,/if \(signal.aborted\) return/,path);
  assert.match(source,/useLayoutEffect\(\(\) => \{[\s\S]*?setRows\(\[\]\)[\s\S]*?site\?\.terminal, site\?\.siteCode/,path);
  assert.match(source,/<PollingStatus \{\.\.\.poll\}/,path);
  assert.doesNotMatch(source,/setInterval|PaginationControls/,path);
 }
});

test('display enrichment stays outside authorization/mutation paths',()=>{
 const source=readFileSync(new URL('../lib/inbound/checkin/backfill-trucking-company.ts',import.meta.url),'utf8');
 assert.match(source,/enrichDisplayCarriers/);assert.doesNotMatch(source,/createClient|\.update\(|lookupMcleodGateOrder/);
 const route=readFileSync(new URL('../app/api/warehouse/domestic-queue/route.ts',import.meta.url),'utf8');
 const writes=route.slice(route.indexOf('async function POSTHandler'));
 assert.doesNotMatch(writes,/enrichDisplayCarriers|lookupDisplayCarrier/);
});
