import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBreakMarks } from '../lib/warehouse/break-marks.ts';
import { warehouseDayRange } from '../lib/warehouse/day-activity.ts';
test('Excel and irregular customer Markdown preserve mark, SO and selected site quantities', () => {
 const input='| BREAKMARK | S.O. # | BALE COUNT | PASADENA | MCKINNEY | |\n| --- | --- | --- | --- | --- | --- |\n| | RZ024 | 52918 | 90 | 0 | 90 |\n| RZ023 | 52917 | 91 | 0 | 91 | |';
 assert.throws(()=>parseBreakMarks(input), /warehouse quantities/);
 assert.deepEqual(parseBreakMarks(input,'mckinney').rows,[{mark:'RZ024',shippingOrder:'52918',bales:90},{mark:'RZ023',shippingOrder:'52917',bales:91}]);
 assert.throws(()=>parseBreakMarks(input,'pasadena'), /No positive/);
 assert.equal(parseBreakMarks('BREAKMARK\tS.O. #\tBALE COUNT\nrZ024\t52918\t90').rows[0].mark,'RZ024');
 assert.equal(parseBreakMarks('MARK,SO,BALES\nABC,123,"1,000"').totalBales,1000);
});
test('bad or repeated quantities block import and zero site counts are skipped',()=>{
 assert.throws(()=>parseBreakMarks('A\t1\t90\nA\t2\t90'),/more than once/);
 assert.throws(()=>parseBreakMarks('A\t1\t9.5'),/whole bale/);
 assert.throws(()=>parseBreakMarks('A\t1\t-1'),/whole bale/);
 assert.equal(parseBreakMarks('A\t1\t0\nB\t2\t90').skippedZero,1);
 assert.throws(()=>parseBreakMarks(Array.from({length:251},(_,i)=>`M${i}\t${i}\t90`).join('\n')),/at most 250/);
});
test('daily activity uses warehouse midnight, with DST and year rollover',()=>{
 for(const terminal of ['HOU','DAL','SAV']) {
  const range=warehouseDayRange(new Date('2026-11-01T12:00:00Z'),terminal);
  assert.equal(range.day,'2026-11-01');assert.equal(Date.parse(range.end)-Date.parse(range.start),25*3600000);
  const spring=warehouseDayRange(new Date('2026-03-08T12:00:00Z'),terminal);
  assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
 }
 assert.equal(warehouseDayRange(new Date('2027-01-01T05:30:00Z'),'HOU').day,'2026-12-31');
 assert.equal(warehouseDayRange(new Date('2027-01-01T05:30:00Z'),'SAV').day,'2027-01-01');
});

test('site defaults use the total on unsplit sheets and only the matching quantity on split sheets',()=>{
 const simple='MARK\tSO\tBALES\nRZ024\t52918\t90';
 assert.equal(parseBreakMarks(simple,'mckinney').totalBales,90);
 assert.equal(parseBreakMarks(simple,'pasadena').totalBales,90);
 const split='MARK\tSO\tBALES\tPASADENA\tMCKINNEY\nA\t1\t90\t0\t90\nB\t2\t91\t91\t0';
 assert.equal(parseBreakMarks(split,'mckinney').rows[0].mark,'A');
 assert.equal(parseBreakMarks(split,'pasadena').rows[0].mark,'B');
});
