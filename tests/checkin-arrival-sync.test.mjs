import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCheckinArrival } from '../lib/inbound/checkin/arrival-sync.ts';
import { CHECKIN_SITES } from '../lib/inbound/checkin/sites.ts';
import { lookupMcleodGateOrder } from '../lib/inbound/checkin/mcleod-order-id.ts';
import { formatWarehouseTime } from '../lib/inbound/checkin/mcleod-time.ts';
process.env.MCLEOD_BASE_URL='https://vendor.example';
process.env.MCLEOD_AUTH_TOKEN='test';

function fixture(site=CHECKIN_SITES[0], direction='delivery', material=site.materials[0]) {
 const row={id:'row',updated_at:'2026-11-09T16:00:00Z',checked_in_at:'2026-11-09T15:32:14Z',terminal:site.terminal,
 site_code:site.siteCode,site_name:site.siteName,movement_direction:direction,material_type:material,matched_order_id:'ORDER1',
 matched_stop_id:'STOP1',reference_number:'ABC',mark:'ABC',yard_status:'waiting'};
 const order={id:'ORDER1',company_id:'TMS',status:'A',revenue_code_id:'MAIN',customer_id:'CUSTOMER',commodity_id:material.toUpperCase(),
 blnum:'ABC',consignee_refno:'ABC',stops:[{id:'STOP1',company_id:'TMS',order_id:'ORDER1',movement_id:'MOVE1',stop_type:direction==='pickup'?'PU':'SO',
 status:'A',location_id:site.siteCode,location:{name:`SCM ${site.siteCode}`,state:site.terminal==='SAV'?'GA':'TX'},
 sched_arrive_early:'20261109070000-0500',sched_arrive_late:'20261109150000-0500'}],movements:[{id:'MOVE1',status:'A'}]};
 if(direction==='delivery') order.stops.push({id:'PICKUP1',company_id:'TMS',order_id:'ORDER1',movement_id:'MOVE1',stop_type:'PU',status:'D',
  location:{name:'Customer warehouse'}, actual_arrival:'20261108080000-0600',actual_departure:'20261108080500-0600',
  sched_arrive_early:'20261107090000-0600',sched_arrive_late:'20261107150000-0600'});
 const event={checkin_id:'row',status:'pending'};const writes=[],pickupWrites=[],calls=[];
 const tables={inbound_checkin_rows:row,inbound_arrival_sync:event};
 const db={from(table){let filters=[],values;
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(v){values=v;return q},single(){return q},maybeSingle(){return q},
   then(resolve){const record=tables[table];const matches=record&&filters.every(([k,v])=>record[k]===v);
    if(matches&&values)Object.assign(record,values);return Promise.resolve({data:matches?structuredClone(record):null,error:null}).then(resolve)}};return q},
  async rpc(name,args){assert.equal(name,'claim_inbound_arrival');if(event.status!=='pending'||row.updated_at!==args.p_revision||row.physical_departed_at)return{data:false};
   Object.assign(event,{status:'writing',snapshot:structuredClone(args.p_snapshot),attempted_at:new Date().toISOString()});return{data:true}}};
 const deps={enabled:()=>true,lookup:lookupMcleodGateOrder,async request(path,body){calls.push(path);if(path.startsWith('/carrierDispatch/clearStop/')){
  const url=new URL(path,'https://vendor.example');const id=decodeURIComponent(url.pathname.split('/').at(-1));
  const patch={actual_arrival:url.searchParams.get('arrivalDate'),actual_departure:url.searchParams.get('departureDate')};
  pickupWrites.push({id,...patch});Object.assign(order.stops.find(s=>s.id===id),patch,{status:'D'});order.movements[0].status='P';return null;
 }if(body){writes.push(structuredClone(body));Object.assign(order.stops[0],body);return null}return structuredClone(order)}};
 return {row,order,event,writes,pickupWrites,calls,db,deps};
}
for(const site of CHECKIN_SITES) for(const direction of ['pickup','delivery']) for(const source of ['driver_qr','staff'])
 test(`${site.siteName} ${direction} ${source}: arrival alone, then replay without write`,async()=>{
 const f=fixture(site,direction);f.row.checkin_source=source;
 const before=structuredClone(f.order);
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced');
 assert.deepEqual(f.writes,[{__type:'stop',company_id:'TMS',id:'STOP1',actual_arrival:formatWarehouseTime(new Date(f.row.checked_in_at),site.terminal)}]);
 assert.equal(f.order.stops[0].actual_departure,undefined);
 assert.equal(f.order.stops[0].sched_arrive_early,before.stops[0].sched_arrive_early);
 assert.equal(f.order.status,'A');assert.equal(f.order.stops[0].status,'A');
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced');assert.equal(f.writes.length,1);
 });

test('all supported materials can send arrival',async()=>{for(const material of ['cotton','lumber','other']){
 const f=fixture(CHECKIN_SITES[0],'pickup',material);assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced');}});
test('unmatched, local only, departed and disabled arrivals do not write',async()=>{for(const patch of [{matched_order_id:null},{local_receiving_only:true},{physical_departed_at:'2026-11-09T17:00Z'},{yard_status:'completed'}]){
 const f=fixture();Object.assign(f.row,patch);await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.writes.length,0);}
 const f=fixture();f.deps.enabled=()=>false;await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.writes.length,0);});
test('existing different actual is never overwritten',async()=>{const f=fixture();f.order.stops[0].actual_arrival='20261109080000-0600';assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'review');assert.equal(f.writes.length,0)});
test('existing identical actual is confirmed without a write',async()=>{const f=fixture();f.order.stops[0].actual_arrival=formatWarehouseTime(new Date(f.row.checked_in_at),f.row.terminal);assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced');assert.equal(f.writes.length,0)});
test('wrong stop, reference, material and completed stop are blocked',async()=>{for(const patch of [{matched_stop_id:'WRONG'},{reference_number:'WRONG'},{material_type:'lumber'}]){
 const f=fixture();Object.assign(f.row,patch);await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.writes.length,0)}
 const f=fixture();f.order.stops[0].actual_departure='20261109110000-0600';await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.writes.length,0)});
test('timeout after vendor accepts is read-only reconciled',async()=>{const f=fixture();const request=f.deps.request;f.deps.request=async(p,b)=>{const r=await request(p,b);if(b)throw Error('timeout');return r};
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'review');assert.equal(f.writes.length,1);
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced');assert.equal(f.writes.length,1)});
test('uncertain write absent from vendor is never replayed',async()=>{const f=fixture();const request=f.deps.request;f.deps.request=async(p,b)=>{if(b){f.writes.push(b);throw Error('timeout')}return request(p)};
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'review');assert.equal(f.writes.length,1)});
test('concurrent replay cannot release an in-flight write fence',async()=>{const f=fixture();let release;const wait=new Promise(r=>release=r);const request=f.deps.request;f.deps.request=async(p,b)=>{if(b)await wait;return request(p,b)};
 const first=syncCheckinArrival(f.db,'row',f.deps);while(f.event.status!=='writing')await new Promise(r=>setImmediate(r));
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'writing');assert.equal(f.event.status,'writing');release();await first;assert.equal(f.writes.length,1)});
test('failed preflight stays pending and can retry safely',async()=>{const f=fixture();const request=f.deps.request;f.deps.request=async()=>{throw Error('offline')};await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.event.status,'pending');f.deps.request=request;assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced')});

for(const site of CHECKIN_SITES) test(`${site.siteName}: missing pickup actuals are backfilled before delivery arrival`,async()=>{
 const f=fixture(site);const pickup=f.order.stops.find(s=>s.stop_type==='PU');
 delete pickup.actual_arrival;delete pickup.actual_departure;pickup.status='A';
 const schedule=[pickup.sched_arrive_early,pickup.sched_arrive_late];
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'synced');
 const offset=site.terminal==='SAV'?'-0500':'-0600';
 assert.deepEqual(f.pickupWrites,[{id:'PICKUP1',actual_arrival:'20261108080000'+offset,actual_departure:'20261108080500'+offset}]);
 assert.ok(f.calls.findIndex(p=>p.startsWith('/carrierDispatch/clearStop/'))<f.calls.indexOf('/stop/update'));
 assert.deepEqual([pickup.sched_arrive_early,pickup.sched_arrive_late],schedule);
 assert.equal(f.order.stops[0].actual_departure,undefined);assert.equal(f.order.stops[0].status,'A');
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.pickupWrites.length,1);assert.equal(f.writes.length,1);
});
test('complete pickups remain unchanged while delivery arrival is posted',async()=>{const f=fixture();const before=structuredClone(f.order.stops[1]);
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.pickupWrites.length,0);assert.deepEqual(f.order.stops[1],before)});
test('partial pickup preserves arrival and fills departure five minutes later',async()=>{const f=fixture();const p=f.order.stops[1];p.actual_arrival='20261108143000-0600';delete p.actual_departure;
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.event.status,'synced');assert.equal(p.actual_arrival,'20261108143000-0600');assert.equal(p.actual_departure,'20261108143500-0600')});
test('pickup backfill failure prevents delivery arrival',async()=>{const f=fixture();delete f.order.stops[1].actual_arrival;delete f.order.stops[1].actual_departure;
 const request=f.deps.request;f.deps.request=async(p,b)=>{if(p.startsWith('/carrierDispatch/'))throw Error('failed');return request(p,b)};
 assert.equal((await syncCheckinArrival(f.db,'row',f.deps)).status,'review');assert.equal(f.writes.length,0);assert.equal(f.order.stops[0].actual_arrival,undefined)});
test('an accepted but uncertain pickup is never repeated or followed by unconfirmed arrival',async()=>{const f=fixture();delete f.order.stops[1].actual_arrival;delete f.order.stops[1].actual_departure;
 const request=f.deps.request;f.deps.request=async(p,b)=>{const r=await request(p,b);if(p.startsWith('/carrierDispatch/'))throw Error('timeout');return r};
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.event.status,'review');assert.equal(f.pickupWrites.length,1);assert.equal(f.writes.length,0);
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.event.status,'review');assert.equal(f.pickupWrites.length,1);assert.equal(f.writes.length,0)});
test('multiple incomplete pickups and receiving-yard pickup are blocked before any write',async()=>{for(const local of [false,true]){
 const f=fixture();const p=f.order.stops[1];delete p.actual_arrival;delete p.actual_departure;
 if(local){p.location=structuredClone(f.order.stops[0].location);p.location_id=f.row.site_code;}else f.order.stops.push({...p,id:'PICKUP2'});
 await syncCheckinArrival(f.db,'row',f.deps);assert.equal(f.writes.length,0);assert.equal(f.pickupWrites.length,0);
}});

test('minute precision confirms arrival only when the order and stop statuses stay unchanged', async () => {
 for (const changedStatus of [false, true]) {
  const f = fixture();
  const request = f.deps.request;
  f.deps.request = async (path, body) => {
   const result = await request(path, body);
   if (path === '/stop/update') {
    f.order.stops[0].actual_arrival = f.order.stops[0].actual_arrival.replace(/\d{2}(?=[+-]\d{4}$)/, '00');
    if (changedStatus) f.order.status = 'D';
   }
   return result;
  };
  assert.equal((await syncCheckinArrival(f.db, 'row', f.deps)).status, changedStatus ? 'review' : 'synced');
  assert.equal(f.writes.length, 1);
 }
});
