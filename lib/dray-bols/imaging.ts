export type DocumentType={id:string;description:string};
export function documentTypes(value:unknown):DocumentType[]{
 if(!Array.isArray(value)||value.length>500||value.some(v=>!v||typeof v.id!=='string'||!v.id||v.id.length>100||typeof v.description!=='string'))throw Error('Unrecognized McLeod document types.');
 return value.map(v=>({id:v.id,description:v.description}));
}
export function imageList(value:unknown):any[]{if(value===null)return [];if(!Array.isArray(value)||value.length>5000||value.some(v=>!v||typeof v.id!=='string'||typeof v.documentTypeId!=='string'))throw Error('Unrecognized McLeod image list.');return value;}
export function imagingClient(){
 const base=process.env.MCLEOD_BASE_URL,token=process.env.MCLEOD_AUTH_TOKEN;
 async function request(path:string,pdf?:Uint8Array){
 if(!base||!token)throw Error('McLeod imaging connection unavailable.');
 if(!/^\/images\/O\/\d{6,7}(?:\/documentTypes|\/[^/?#]+)?$/.test(path))throw Error('Invalid imaging operation.');
 if(pdf&&(process.env.DRAY_IMPORT_WRITES_ENABLED!=='true'||process.env.MCLEOD_SYNC_ENABLED!=='true'))throw Error('McLeod uploads are disabled.');
 const res=await fetch(base.replace(/\/$/,'')+path,{method:pdf?'POST':'GET',headers:{Authorization:'Bearer '+token,Accept:pdf?'text/plain':'application/json','X-com.mcleodsoftware.CompanyID':'TMS',...(pdf?{'Content-Type':'application/pdf'}:{})},body:pdf?Buffer.from(pdf):undefined,cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Error('McLeod imaging HTTP '+res.status);
 if(pdf){const receipt=(await res.text()).trim();if(!receipt||receipt.length>500)throw Error('Unrecognized McLeod upload receipt.');try{const j=JSON.parse(receipt);if(typeof j==='string'&&j)return j;}catch{}return receipt;}
 return res.json();
 }
 return {types:async(id:string)=>documentTypes(await request('/images/O/'+id+'/documentTypes')),images:async(id:string)=>imageList(await request('/images/O/'+id)),upload:async(id:string,type:string,pdf:Uint8Array)=>String(await request('/images/O/'+id+'/'+encodeURIComponent(type),pdf))};
}
export function receiptVisible(images:any[],receipt:string,type:string){return images.some(v=>v.id===receipt&&v.documentTypeId===type&&v.companyId==='TMS');}
