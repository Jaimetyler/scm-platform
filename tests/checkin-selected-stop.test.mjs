import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMcleodYardStop } from '../lib/inbound/checkin/yard-stop.ts';
const stop = (id,type,yard='5300',extra={})=>({id,stop_type:type,location:{name:`SCM Houston ${yard}`},...extra});
test('direction is applied before ambiguity, without crossing yards',()=>{
  const order={stops:[stop('P','PU'),stop('D','SO'),stop('OTHER','PU','4331')],movements:[{id:'M'}]};
  assert.equal(selectMcleodYardStop(order,'HOU','Houston 5300','pickup').stop.id,'P');
  assert.equal(selectMcleodYardStop(order,'HOU','Houston 5300','delivery').stop.id,'D');
  assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300'),e=>e.code==='AMBIGUOUS_YARD_STOP');
  assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300','pickup','OTHER'),e=>e.code==='STALE_STOP_SELECTION');
});
test('root and nested movement stops deduplicate, movement stays tied to chosen stop',()=>{
  const p=stop('P','PU');const order={stops:[p],curr_movement_id:'WRONG',movements:[{id:'WRONG',stops:[stop('OTHER','PU','4331')]},{id:'RIGHT',stops:[p]}]};
  const result=selectMcleodYardStop(order,'HOU','Houston 5300','pickup');
  assert.equal(result.stops.length,2);assert.equal(result.movement.id,'RIGHT');
});
test('repeated visits require exact selection and stale selection never chooses a replacement',()=>{
  const order={stops:[stop('FIRST','PU'),stop('SECOND','PU')]};
  assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300','pickup'),e=>e.code==='AMBIGUOUS_YARD_STOP');
  assert.equal(selectMcleodYardStop(order,'HOU','Houston 5300','pickup','SECOND').stop.id,'SECOND');
  order.stops.pop();assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300','pickup','SECOND'),e=>e.code==='STALE_STOP_SELECTION');
});
test('sole movement with explicit other-stop membership is not attributed to an unrelated root stop',()=>{
  const order={stops:[stop('P','PU')],movements:[{id:'WRONG',stops:[stop('OTHER','PU','4331')]}]};
  assert.equal(selectMcleodYardStop(order,'HOU','Houston 5300','pickup').movement,undefined);
});
test('conflicting root and nested stop locations fail closed rather than prefer last representation',()=>{
  const order={stops:[stop('P','PU','4331')],movements:[{id:'M',stops:[stop('P','PU','5300')]}]};
  assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300','pickup'),e=>e.code==='CONFLICTING_STOP_IDENTITY');
});
test('opaque location IDs and explicit conflicting terminal evidence cannot authorize a yard match',()=>{
  for(const location of [{name:'SCM Houston 4331',address1:'4331 Warehouse Road',id:'5300'},
    {name:'SCM Savannah 5300',city_name:'Savannah',state:'GA'},
    {name:'SCM Houston 4331',address1:'5300 Warehouse Road'}]) {
    assert.throws(()=>selectMcleodYardStop({stops:[{id:'P',stop_type:'PU',location}]},'HOU','Houston 5300','pickup'),e=>e.code==='YARD_STOP_NOT_FOUND');
  }
});
test('explicit stop movement cannot contradict its enclosing movement',()=>{
  const order={movements:[{id:'RIGHT',stops:[stop('P','PU','5300',{movement_id:'WRONG'})]},{id:'WRONG',stops:[]}]};
  assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300','pickup'),e=>e.code==='CONFLICTING_STOP_IDENTITY');
});
test('all configured Savannah yard names override conflicting address hints',()=>{
  for(const yard of ['246','175']) assert.throws(()=>selectMcleodYardStop({stops:[{id:'S',stop_type:'SO',location:{name:`SCM Savannah ${yard}`,address1:'984 Warehouse Road'}}]},'SAV','Savannah 984','delivery'),e=>e.code==='YARD_STOP_NOT_FOUND');
});
test('sparse nested stop location preserves verified root location fields',()=>{
  const order={stops:[stop('S','SO','5300',{location:{name:'SCM Houston 5300',id:'LOC'}})],movements:[{id:'M',stops:[{id:'S',stop_type:'SO',location:{id:'LOC'}}]}]};
  const selected=selectMcleodYardStop(order,'HOU','Houston 5300','delivery');
  assert.equal(selected.stop.location.name,'SCM Houston 5300');assert.equal(selected.movement.id,'M');
});
test('conflicting duplicate city evidence is an integrity error, not a false other-yard no-match',()=>{
  const order={stops:[{id:'S',stop_type:'SO',location:{name:'SCM Houston 5300',city:'Houston'}}],movements:[{id:'M',stops:[{id:'S',stop_type:'SO',location:{city_name:'Savannah'}}]}]};
  assert.throws(()=>selectMcleodYardStop(order,'HOU','Houston 5300','delivery'),e=>e.code==='CONFLICTING_STOP_IDENTITY');
});
