import {createHash} from 'node:crypto';
import {createBol,filename,type BolData} from './pdf.ts';
export const bolBucket='savannah-dray-bols';
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
async function readDocument(db:any,document:any){
 if(document.path!==document.mcleod_order+'/'+document.pdf_hash+'.pdf')throw Error('Saved BOL path is invalid.');
 const {data,error}=await db.storage.from(bolBucket).download(document.path);
 if(error||!data)throw Error('Saved BOL could not be retrieved.');
 const bytes=new Uint8Array(await data.arrayBuffer());
 if(bytes.length!==document.byte_length||sha(bytes)!==document.pdf_hash)throw Error('Saved BOL verification failed.');
 return {document,bytes};
}
export async function savedBol(db:any,item:any){
 const {data,error}=await db.from('dray_bol_documents').select('*').eq('order_id',item.order_id).eq('source_hash',item.order.source_hash).eq('bol_bales',item.bol_bales).maybeSingle();
 if(error)throw Error('Saved BOL record unavailable.');
 if(!data)return null;
 if(data.mcleod_order!==item.order.order_id)throw Error('Saved BOL order differs from import.');
 return readDocument(db,data);
}
export async function persistBol(db:any,item:any,plan:BolData,actor:string){
 const planHash=sha(JSON.stringify(plan)),existing=await savedBol(db,item);
 if(existing){if(existing.document.plan_hash!==planHash)throw Error('Saved BOL details differ; review required.');return existing;}
 const bytes=await createBol(plan),pdfHash=sha(bytes),path=plan.orderId+'/'+pdfHash+'.pdf';
 if(bytes.length>3145728)throw Error('Generated BOL exceeds 3 MB.');
 const {error:uploadError}=await db.storage.from(bolBucket).upload(path,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'0'});
 // A concurrent request may already have uploaded the exact immutable bytes.
 if(uploadError&&!["409","Duplicate"].includes(String(uploadError.statusCode||uploadError.error)))throw Error('BOL could not be saved to storage.');
 const document={order_id:item.order_id,mcleod_order:plan.orderId,source_hash:item.order.source_hash,bol_bales:item.bol_bales,plan_hash:planHash,pdf_hash:pdfHash,path,filename:filename(plan),byte_length:bytes.length,actor};
 // Read back the private object before recording it or making a McLeod request.
 await readDocument(db,document);
 const {data,error}=await db.from('dray_bol_documents').insert(document).select('*').single();
 if(error){if(error.code==='23505'){const concurrent=await savedBol(db,item);if(concurrent&&concurrent.document.plan_hash===planHash)return concurrent;}throw Error('BOL file saved, but its document record could not be saved. Retry generation; do not send to McLeod yet.');}
 return {document:data,bytes};
}
