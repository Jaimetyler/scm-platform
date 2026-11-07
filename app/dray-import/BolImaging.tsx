"use client";
import {useState} from 'react';
export default function BolImaging({runId,rowId,orderId,busy,onBusy}:{runId:string;rowId:string;orderId:string;busy:boolean;onBusy:(v:boolean)=>void}){
 const [options,setOptions]=useState<any>(null),[type,setType]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState('');
 async function call(action:string,extra:Record<string,unknown>={}){const r=await fetch('/api/dray-import/bols/imaging',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,rowId,action,...extra})});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'McLeod imaging unavailable');return j;}
 async function load(){const j=await call('options');setOptions(j);const bols=j.types.filter((t:any)=>/^(BOL|BILL OF LADING)$/i.test(t.description.trim()));if(bols.length===1)setType(bols[0].id);}
 async function act(fn:()=>Promise<void>){if(busy)return;onBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Imaging unavailable')}finally{onBusy(false)}}
 return <section style={{marginTop:20}}><h3>McLeod imaging</h3>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!options?<button disabled={busy} onClick={()=>void act(load)}>Check document types</button>:<>
 <label>Document type <select style={{background:"#102137",color:"#edf5ff",border:"1px solid #405d7b",borderRadius:6,padding:8,maxWidth:"100%"}} aria-label="McLeod document type" disabled={busy} value={type} onChange={e=>setType(e.target.value)}><option value="">Select BOL document type</option>{options.types.map((t:any)=><option key={t.id} value={t.id}>{t.description} ({t.id})</option>)}</select></label>
 <button disabled={busy||!type||!options.writesEnabled} onClick={()=>{if(!window.confirm(`Send this signed BOL to SCM order number ${orderId} in McLeod as ${options.types.find((t:any)=>t.id===type)?.description}?`))return;void act(async()=>{const j=await call('send',{documentTypeId:type,confirmed:true});setNotice(j.message);await load();});}}>Send BOL to McLeod</button>
 {options.receipts.map((r:any)=><p key={r.id}>BOL: {r.status==='verified'?'Indexed':r.status==='staged'?'Accepted — indexing pending':r.status==='sending'?'Sending / awaiting confirmation':'Needs review'}{r.receipt?' · '+r.receipt:''}{r.status!=='verified'&&<button disabled={busy} onClick={()=>void act(async()=>{const j=await call('reconcile',{receiptId:r.id});setNotice(j.message||'BOL verified in McLeod imaging.');await load();})}>Check indexing</button>}</p>)}
 </>}
 </section>;
}
