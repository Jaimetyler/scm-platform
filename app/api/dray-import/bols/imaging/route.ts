import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {withStaffAccess,staffActor} from '@/lib/auth/guard';
import {staffDatabase} from '@/lib/auth/session';
import {readRun,vendor} from '@/lib/dray/server';
import {bolPlan} from '@/lib/dray-bols/plan';
import {bolEligible} from '@/lib/dray-bols/eligible';
import {createBol} from '@/lib/dray-bols/pdf';
import {imagingClient,receiptVisible} from '@/lib/dray-bols/imaging';
export const dynamic='force-dynamic';export const maxDuration=120;
export const POST=withStaffAccess(async(req:NextRequest)=>{
 try{
 const body=await req.json(),db=staffDatabase();
 if(!/^[0-9a-f-]{36}$/i.test(body.runId||'')||!/^[0-9a-f-]{36}$/i.test(body.rowId||''))throw Error('Select a saved import order.');
 const {items}=await readRun(db,body.runId),item=items.find(x=>x.order_id===body.rowId);if(!bolEligible(item))throw Error('Saved BOL details are incomplete.');
 const order=await vendor(true).read('/orders/'+item.order.order_id),plan=bolPlan(item,order),client=imagingClient();
 const types=await client.types(plan.orderId);
 const {data:receipts,error:readError}=await db.from('dray_bol_images').select('id,status,receipt,document_type,updated_at').eq('order_id',item.order_id).order('created_at',{ascending:false});if(readError)throw Error('BOL upload history unavailable.');
 if(body.action==='options')return NextResponse.json({ok:true,types,receipts,writesEnabled:process.env.DRAY_IMPORT_WRITES_ENABLED==='true'&&process.env.MCLEOD_SYNC_ENABLED==='true'});
 if(body.action==='reconcile'){
 const record=receipts?.find(r=>r.id===body.receiptId);if(!record)throw Error('Upload receipt not found.');
 const images=await client.images(plan.orderId);if(record.receipt&&receiptVisible(images,record.receipt,record.document_type)){
 const {error}=await db.from('dray_bol_images').update({status:'verified',updated_at:new Date().toISOString()}).eq('id',record.id);if(error)throw Error('Could not save imaging verification.');return NextResponse.json({ok:true,status:'verified',receipt:record.receipt});}
 return NextResponse.json({ok:true,status:record.status,receipt:record.receipt,message:'Not yet verified in McLeod imaging. No upload was retried.'});
 }
 if(body.action!=='send'||body.confirmed!==true||!types.some(t=>t.id===body.documentTypeId))throw Error('Select and confirm a McLeod document type.');
 if(process.env.DRAY_IMPORT_WRITES_ENABLED!=='true'||process.env.MCLEOD_SYNC_ENABLED!=='true')throw Error('McLeod uploads are disabled.');
 const bytes=await createBol(plan),digest=createHash('sha256').update(bytes).digest('hex');
 const existing=await client.images(plan.orderId);if(existing.some(v=>v.documentTypeId===body.documentTypeId))throw Error('This order already has a document of that type. Review McLeod before adding another.');
 const {data:claim,error}=await db.from('dray_bol_images').insert({order_id:item.order_id,mcleod_order:plan.orderId,pdf_hash:digest,document_type:body.documentTypeId,status:'sending',actor:staffActor(req)}).select('id').single();
 if(error){if(error.code==='23505')throw Error('This BOL already has an upload attempt. Check its receipt; do not resend.');throw Error('Could not reserve BOL upload.');}
 let receipt:string|null=null,status='uncertain';
 try{receipt=await client.upload(plan.orderId,body.documentTypeId,bytes);status='staged';try{if(receiptVisible(await client.images(plan.orderId),receipt,body.documentTypeId))status='verified';}catch{/* Successful receipt remains staged when read-back is unavailable. */}}
 catch{/* An HTTP error or timeout may still have stored the image. Never retry automatically. */}
 const {error:saveError}=await db.from('dray_bol_images').update({status,receipt,updated_at:new Date().toISOString()}).eq('id',claim.id);if(saveError)throw Error('Upload outcome could not be saved. Check McLeod; do not resend.');
 return NextResponse.json({ok:true,status,receipt,message:status==='verified'?'BOL verified in McLeod imaging.':status==='staged'?'Accepted by McLeod; indexing verification pending.':'Upload outcome is uncertain. Check McLeod; do not resend.'});
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Imaging request failed'},{status:400});}
});
