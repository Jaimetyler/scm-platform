import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as limits from '../lib/warehouse/outbound/upload-limits.ts';
function client(fetch) {
 const mod={exports:{}};
 const code=ts.transpileModule(readFileSync('lib/warehouse/outbound/upload-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports','fetch',code)(()=>limits,mod,mod.exports,fetch);
 return mod.exports.attachBookingFile;
}
test('6 MB workbook goes directly to signed storage and preview/save reuse only its receipt',async()=>{
 const calls=[];
 const attach=client(async(url,init)=>{calls.push({url,init});return url.startsWith('/api/')?{ok:true,json:async()=>({ok:true,signedUrl:'https://private-storage.invalid/upload',receipt:'signed-receipt'})}:{ok:true};});
 const file=new File([new Uint8Array(6*1024*1024)],'large.xlsb');const first=new FormData();
 await attach(first,file,'DAL');
 assert.equal(calls.length,2);assert.equal(calls[0].init.body.includes('large.xlsb'),true);assert.equal(calls[1].init.body,file);
 assert.equal(first.has('file'),false);assert.equal(first.get('uploadReceipt'),'signed-receipt');
 const save=new FormData();await attach(save,file,'DAL');assert.equal(calls.length,2);assert.equal(save.get('uploadReceipt'),'signed-receipt');
});
test('small workbooks keep the normal path and failed large uploads never return a usable receipt',async()=>{
 const attach=client(async()=>{throw Error('Should not upload small files');});
 const small=new File(['abc'],'small.xlsx');const form=new FormData();await attach(form,small,'DAL');assert.equal(form.get('file').size,3);
 const failing=client(async(url)=>url.startsWith('/api/')?{ok:true,json:async()=>({ok:true,signedUrl:'https://storage.invalid',receipt:'token'})}:{ok:false,status:413});
 const large=new FormData();await assert.rejects(failing(large,new File([new Uint8Array(4*1024*1024)],'large.xlsx'),'DAL'),/413/);assert.equal(large.has('uploadReceipt'),false);
});
