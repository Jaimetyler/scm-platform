"use client";
import {useEffect,useState} from "react";
import styles from "./equipment.module.css";
import {equipmentChoices,feeBases,type EquipmentPolicy} from "@/lib/cotton-locations/equipment";
export default function EquipmentEditor({locationId,admin,canWrite=true,onBusy,onSaved}:{locationId:string;admin:boolean;canWrite?:boolean;onBusy?:(busy:boolean)=>void;onSaved?:()=>Promise<void>}){
 const [policy,setPolicy]=useState<EquipmentPolicy|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{const controller=new AbortController();setPolicy(null);setError("");fetch('/api/cotton-locations/outreach/equipment?locationId='+encodeURIComponent(locationId),{cache:'no-store',signal:controller.signal}).then(async r=>{const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Equipment unavailable');setPolicy(j.policy)}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>controller.abort()},[locationId]);
 async function save(){if(!policy||busy)return;setBusy(true);onBusy?.(true);setError("");setNotice("");try{
 const r=await fetch('/api/cotton-locations/outreach/equipment',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...policy,verified:admin?policy.verified:false})});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Save failed');setPolicy(j.policy);setNotice('Equipment evidence saved with audit history.');await onSaved?.();
 }catch(e){setError(e instanceof Error?e.message:'Save failed')}finally{setBusy(false);onBusy?.(false)}}
 return <section className={styles.editor}><h3>Van / flatbed restrictions & fee</h3><p>Prioritize TX, OK, KS and NM. Confirm the current tariff, accepted equipment, fee basis, payer and any advance-notice or seasonal conditions.</p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{!policy&&!error&&<p>Loading equipment evidence…</p>}{policy&&<fieldset disabled={busy||!canWrite} style={{display:'grid',gap:14,border:0,padding:0,margin:0}}>
 <label>Equipment accepted<select value={policy.accepted_equipment} onChange={e=>setPolicy({...policy,accepted_equipment:e.target.value})}>{equipmentChoices.map(v=><option key={v} value={v}>{v==='unknown'?'Unknown / needs confirmation':v==='van_only'?'Van only':'Van and flatbed'}</option>)}</select></label>
 <label>Flatbed fee basis<select value={policy.fee_basis} onChange={e=>setPolicy({...policy,fee_basis:e.target.value,fee_amount:e.target.value==='unknown'?null:e.target.value==='none'?0:policy.fee_amount})}>{feeBases.map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label>
 <label>Flatbed fee amount<input type="number" min="0" max="100000" step="0.01" disabled={policy.fee_basis==='unknown'||policy.fee_basis==='none'} value={policy.fee_amount??''} onChange={e=>setPolicy({...policy,fee_amount:e.target.value===''?null:Number(e.target.value)})}/></label>
 <label>Fee payer<select value={policy.fee_payer} onChange={e=>setPolicy({...policy,fee_payer:e.target.value})}>{['unknown','shipper','carrier'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
 <label>Conditions / other fee basis<textarea rows={3} maxLength={2000} value={policy.conditions} onChange={e=>setPolicy({...policy,conditions:e.target.value})}/></label>
 <label>Tariff / contact source<input maxLength={1000} value={policy.source_reference} onChange={e=>setPolicy({...policy,source_reference:e.target.value})}/></label>
 <label>Equipment policy effective date<input type="date" value={policy.effective_date||''} onChange={e=>setPolicy({...policy,effective_date:e.target.value||null})}/></label>
 {admin?<label><input type="checkbox" checked={policy.verified} onChange={e=>setPolicy({...policy,verified:e.target.checked})}/> Equipment and fee confirmed by source</label>:<p>Collected changes are saved as unverified for administrator review.</p>}
 <p>No fee is automatically added to carrier pay or billing.</p><button disabled={!policy.source_reference.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save equipment evidence'}</button>
 </fieldset>}</section>;
}
