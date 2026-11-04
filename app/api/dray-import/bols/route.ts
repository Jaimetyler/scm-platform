import {NextRequest,NextResponse} from 'next/server';
import {withStaffAccess} from '@/lib/auth/guard';
import {staffDatabase} from '@/lib/auth/session';
import {readRun,vendor} from '@/lib/dray/server';
import {bolEligible} from '@/lib/dray-bols/eligible';
import {bolPlan} from '@/lib/dray-bols/plan';
import {createBol,filename} from '@/lib/dray-bols/pdf';
import {zipSync} from 'fflate';
export const dynamic='force-dynamic';export const maxDuration=300;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const POST=withStaffAccess(async(req:NextRequest)=>{
 try{
 if(Number(req.headers.get('content-length')||0)>16000)throw Error('Request too large.');
 const body=await req.json();if(!uuid(body.runId)||!Array.isArray(body.rowIds)||!body.rowIds.length||body.rowIds.length>100||!body.rowIds.every(uuid)||new Set(body.rowIds).size!==body.rowIds.length||!['pdf','zip'].includes(body.format)||body.format==='pdf'&&body.rowIds.length!==1)throw Error('Select up to 100 saved orders.');
 const {items}=await readRun(staffDatabase(),body.runId),read=vendor(true).read;
 const selected=body.rowIds.map((id:string)=>{const item=items.find(x=>x.order_id===id);if(!item)throw Error('Selected order is not in this import run.');if(!bolEligible(item))throw Error('Selected order needs verified references and saved BOL bale counts.');return item;});
 const files:Record<string,Uint8Array>={};let cursor=0;
 await Promise.all(Array.from({length:3},async()=>{while(cursor<selected.length){const item=selected[cursor++];const order=await read('/orders/'+encodeURIComponent(item.order.order_id||''));const plan=bolPlan(item,order);const name=filename(plan);if(files[name])throw Error('Duplicate document name; review selection.');files[name]=await createBol(plan);}}));
 const single=Object.entries(files)[0],bytes=body.format==='pdf'?single[1]:zipSync(files,{level:0}),name=body.format==='pdf'?single[0].split('/').pop()!:'Savannah_BOLs_'+body.runId.slice(0,8)+'.zip';
 return new NextResponse(Buffer.from(bytes),{headers:{'Content-Type':body.format==='pdf'?'application/pdf':'application/zip','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'BOL generation failed'},{status:400});}
});
