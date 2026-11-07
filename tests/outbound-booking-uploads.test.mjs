import test from 'node:test';
import assert from 'node:assert/strict';
import {signBookingUpload,verifyBookingUpload,readBookingSource} from '../lib/warehouse/outbound/booking-source.ts';
import {MAX_BOOKING_BYTES,validateBookingFile} from '../lib/warehouse/outbound/upload-limits.ts';
const owner='11111111-1111-4111-8111-111111111111';
const receipt={owner,terminal:'DAL',path:owner+'/22222222-2222-4222-8222-222222222222.xlsb',name:'Dray request.xlsb',size:6*1024*1024,expires:Date.now()+3600000};
const secret='test-secret-only';
test('signed receipts allow a 6 MB file and reject tampering, other users/terminals and expiry',()=>{
 const token=signBookingUpload(receipt,secret);
 assert.equal(verifyBookingUpload(token,owner,'DAL',secret).size,receipt.size);
 for(const [who,terminal,time] of [['someone-else','DAL',Date.now()],[owner,'HOU',Date.now()],[owner,'DAL',Date.now()+7200000]])
  assert.throws(()=>verifyBookingUpload(token,who,terminal,secret,time),/expired|another/);
 assert.throws(()=>verifyBookingUpload(token.slice(0,-1)+(token.endsWith('0')?'1':'0'),owner,'DAL',secret),/Invalid/);
 assert.throws(()=>verifyBookingUpload(signBookingUpload({...receipt,path:'../other.xlsx'},secret),owner,'DAL',secret),/another/);
});
test('large file is downloaded by verified receipt, while small multipart uploads remain supported',async()=>{
 const form=new FormData();form.set('uploadReceipt',signBookingUpload(receipt,secret));let path;
 const source=await readBookingSource(form,{owner,terminal:'DAL',secret,download:async p=>{path=p;return {data:new Blob([new Uint8Array(receipt.size)]),error:null};}});
 assert.equal(source.bytes.length,6*1024*1024);assert.equal(source.name,receipt.name);assert.equal(path,receipt.path);
 await assert.rejects(readBookingSource(form,{owner,terminal:'DAL',secret,download:async()=>({data:new Blob(['wrong']),error:null})}),/size does not match/);
 const small=new FormData();small.set('file',new File(['test'],'request.xlsx'));
 assert.equal((await readBookingSource(small,{owner:'',terminal:'DAL',secret:'',download:async()=>{throw Error('No storage required');}})).bytes.toString(),'test');
});
test('25 MB is accepted and larger, empty, or unsupported formats are rejected precisely',()=>{
 assert.doesNotThrow(()=>validateBookingFile('request.xlsb',MAX_BOOKING_BYTES));
 assert.throws(()=>validateBookingFile('request.xlsx',MAX_BOOKING_BYTES+1),/25 MB/);
 assert.throws(()=>validateBookingFile('request.xlsx',0),/empty/);
 assert.throws(()=>validateBookingFile('request.pdf',100),/xlsx or .xlsb/);
});
