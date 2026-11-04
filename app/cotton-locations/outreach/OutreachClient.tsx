"use client";
import {useEffect,useRef,useState} from "react";
import styles from "./outreach.module.css";
import {existingTariffUrl,type ExistingTariff} from "@/lib/cotton-locations/existing-tariffs";
import EquipmentEditor from "../EquipmentEditor";
import type {EquipmentPolicy} from "@/lib/cotton-locations/equipment";
const statuses=["not_requested","requested","follow_up","received","reviewed"];
const label=(s:string)=>s.replaceAll("_"," ");
type Facility={equipment?:EquipmentPolicy|null;existingTariffs?:ExistingTariff[];location_id:string;priority:boolean;priority_reason:string;status:string;contact_name:string;contact_email:string;contact_phone:string;last_contact:string|null;next_follow_up:string|null;effective_date:string|null;notes:string;version:number;hours:string;location:{mcleod_code:string;prev_code:string|null;name:string;city:string;state:string;address:string};documents:{id:string;filename:string;uploaded_at:string;uploaded_by:string}[];events:{id:number;action:string;actor:string;created_at:string;after_value:Record<string,unknown>}[]};
export default function OutreachClient({admin,canWrite}:{admin:boolean;canWrite:boolean}){
 const [tab,setTab]=useState("outreach");
 const [rows,setRows]=useState<Facility[]>([]),[query,setQuery]=useState(""),[filter,setFilter]=useState("priority"),[selected,setSelected]=useState<Facility|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const saved=selected?rows.find(r=>r.location_id===selected.location_id):null;
 const dirty=!!selected&&!!saved&&JSON.stringify(selected)!==JSON.stringify(saved);
 const dialog=useRef<HTMLDialogElement>(null),fileInput=useRef<HTMLInputElement>(null),opener=useRef<HTMLButtonElement|null>(null);
 async function load(){const r=await fetch("/api/cotton-locations/outreach",{cache:"no-store"});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||"Unable to load queue");setRows(j.rows);return j.rows as Facility[];}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 useEffect(()=>{if(selected)dialog.current?.showModal();else if(dialog.current?.open){dialog.current.close();opener.current?.focus()}},[selected]);
 function close(){if(!busy){setSelected(null);setError("")}}
 async function save(){if(!selected||busy)return;setBusy(true);setError("");try{
 const res=await fetch("/api/cotton-locations/outreach",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...selected,locationId:selected.location_id})});const j=await res.json();if(!res.ok||!j.ok)throw Error(j.error||"Save failed");
 const updated=await load();setSelected(updated.find(r=>r.location_id===selected.location_id)||null);setNotice("Outreach update saved.");
 }catch(e){setError(e instanceof Error?e.message:"Save failed")}finally{setBusy(false)}}
 async function upload(){const file=fileInput.current?.files?.[0];if(!selected||!file||busy)return;setBusy(true);setError("");try{
 if(file.size>3*1024*1024)throw Error("Maximum file size is 3 MB.");
 const data=new FormData();data.set("locationId",selected.location_id);data.set("file",file);
 const res=await fetch("/api/cotton-locations/outreach/documents",{method:"POST",body:data});const j=await res.json();if(!res.ok||!j.ok)throw Error(j.error||"Upload failed");
 const updated=await load();setSelected(updated.find(r=>r.location_id===selected.location_id)||null);setNotice("Tariff uploaded. Awaiting review.");if(fileInput.current)fileInput.current.value="";
 }catch(e){setError(e instanceof Error?e.message:"Upload failed")}finally{setBusy(false)}}
 const today=new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});
 const due=(r:Facility)=>!!r.next_follow_up&&r.next_follow_up<=today&&r.status!=="reviewed";
 const filtered=rows.filter(r=>(filter==="equipment"&&["TX","OK","KS","NM"].includes(r.location.state)&&!r.equipment?.verified||filter==="on_file"&&!!r.existingTariffs?.length||filter==="all"||filter==="priority"&&r.priority||filter==="due"&&due(r)||filter==="missing"&&r.hours==="No saved hours"||filter==="review"&&r.status==="received"||filter===r.status)&&[r.location.mcleod_code,r.location.prev_code,r.location.name,r.location.city,r.contact_name].some(v=>v?.toLowerCase().includes(query.trim().toLowerCase())));
 function textField(key:"contact_name"|"contact_email"|"contact_phone"|"last_contact"|"next_follow_up"|"effective_date",title:string,type="text"){return <label>{title}<input type={type} value={selected?.[key]||""} onChange={e=>setSelected(v=>v?{...v,[key]:e.target.value||(type==="date"?null:"")}:v)}/></label>}
 return <main className={styles.page}>
 <header className={styles.header}><div><p className={styles.eyebrow}>COTTON LOCATIONS</p><h1>Tariff outreach</h1><p>Current written tariffs come first</p></div><a href={admin?"/cotton-locations":"/warehouse"}>{admin?"Location management":"Warehouse home"}</a></header>
 <div className={styles.stats}><span><b>{rows.filter(r=>r.priority).length}</b> Priority batch</span><span><b>{rows.filter(r=>r.status==="received").length}</b> Awaiting review</span><span><b>{rows.filter(r=>r.status==="reviewed").length}</b> Reviewed</span><span><b>{rows.filter(due).length}</b> Follow-ups due</span></div>
 <div className={styles.toolbar}><input aria-label="Search outreach" placeholder="Search facility, code, city or contact" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter outreach" value={filter} onChange={e=>setFilter(e.target.value)}><option value="priority">Priority batch</option><option value="all">All facilities</option><option value="equipment">Equipment review — TX / OK / KS / NM</option><option value="on_file">Existing tariff on file</option><option value="due">Follow-ups due</option><option value="missing">No saved hours</option><option value="review">Awaiting review</option>{statuses.filter(s=>s!=="received").map(s=><option key={s} value={s}>{label(s)}</option>)}</select><button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Refresh</button></div>
 {error&&!selected&&<p role="alert" className={styles.error}>{error}</p>}{notice&&!selected&&<p role="status">{notice}</p>}
 <p>{filtered.length} facilities shown · {rows.length} total</p>
 <div className={styles.tableWrap}><table><thead><tr><th>Facility</th><th>City</th><th>Tariff</th><th>Hours</th><th>Follow-up</th><th/></tr></thead><tbody>{filtered.map(r=><tr key={r.location_id}><td><strong>{r.location.mcleod_code}</strong><small>{r.location.name}</small></td><td>{r.location.city}, {r.location.state}</td><td><span className={styles.badge}>{r.existingTariffs?.length&&r.status==="not_requested"?"On file · needs review":label(r.status)}</span>{!!r.existingTariffs?.length&&<small>{r.existingTariffs.length} existing source document(s)</small>}<small>{r.documents.length} documents</small></td><td>{r.hours}</td><td className={due(r)?styles.due:undefined}>{r.next_follow_up||"—"}</td><td><button onClick={e=>{opener.current=e.currentTarget;setError("");setNotice("");setTab("outreach");setSelected({...r})}}>Open</button></td></tr>)}</tbody></table>{!filtered.length&&<p className={styles.empty}>No facilities match this filter.</p>}</div>
 <dialog ref={dialog} className={styles.dialog} aria-labelledby="outreach-title" onCancel={e=>{e.preventDefault();close()}}>
 {selected&&<><div className={styles.dialogHeader}><div><small>{selected.location.mcleod_code} · {selected.location.city}, {selected.location.state}</small><h2 id="outreach-title">{selected.location.name}</h2><p>{selected.location.address}</p></div><button aria-label="Close facility" disabled={busy} onClick={close}>×</button></div>
 <nav className={styles.tabs} aria-label="Facility sections">{[["outreach","Outreach"],["documents","Tariff documents"],["equipment","Equipment"],["activity","Activity"]].map(([id,title])=><button key={id} disabled={busy} className={tab===id?styles.activeTab:undefined} aria-current={tab===id?"page":undefined} onClick={()=>setTab(id)}>{title}</button>)}</nav>
 <div className={styles.body}>{error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div hidden={tab!=="outreach"}>
 <fieldset disabled={busy||!canWrite||(selected.status==="reviewed"&&!admin)} className={styles.form}>
 <div className={styles.grid}><label>Tariff status<select value={selected.status} onChange={e=>setSelected({...selected,status:e.target.value})}>{statuses.map(s=><option key={s} value={s} disabled={s==="reviewed"&&!admin}>{label(s)}</option>)}</select></label></div>
 <label className={styles.check}><input type="checkbox" checked={selected.priority} onChange={e=>setSelected({...selected,priority:e.target.checked})}/> Include in priority batch</label>
 <div className={styles.grid}>{textField("contact_name","Facility contact")}{textField("contact_email","Contact email","email")}{textField("contact_phone","Contact phone","tel")}{textField("last_contact","Last contact","date")}{textField("next_follow_up","Next follow-up","date")}{textField("effective_date","Tariff effective date","date")}</div>
 <button onClick={()=>void save()}>{busy?"Saving…":"Save outreach update"}</button></fieldset></div>
 <section hidden={tab!=="documents"} className={styles.documents}><h3>Tariff documents</h3> {!!selected.existingTariffs?.length&&<section className={styles.documents}><h3>Already on file — review before requesting again</h3>{selected.existingTariffs.map(t=><p key={t.fileId}><a href={existingTariffUrl(t.fileId)} target="_blank" rel="noreferrer">{t.filename}</a><small>Effective: {t.effectiveDate||"Needs confirmation"} · Awaiting review</small></p>)}</section>}
{selected.documents.map(d=><p key={d.id}><a href={`/api/cotton-locations/outreach/documents?id=${d.id}`} target="_blank" rel="noreferrer">{d.filename}</a><small>{new Date(d.uploaded_at).toLocaleString()} · {d.uploaded_by}</small></p>)}{!selected.documents.length&&<p>No tariff uploaded yet.</p>}{canWrite&&<div><input ref={fileInput} aria-label="Tariff file" type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy}/><button disabled={busy||dirty} onClick={()=>void upload()}>Upload tariff</button>{dirty&&<p>Save outreach edits before uploading.</p>}</div>}</section>
 <section hidden={tab!=="equipment"} className={styles.documents}><EquipmentEditor key={selected.location_id} locationId={selected.location_id} admin={admin} canWrite={canWrite} onBusy={setBusy} onSaved={async()=>{const updated=await load();setSelected(current=>current?{...current,equipment:updated.find(r=>r.location_id===current.location_id)?.equipment}:null)}}/></section>
 <section hidden={tab!=="activity"}><h3>Recent activity</h3>{!selected.events.length&&<p>No activity recorded yet.</p>}{selected.events.map(e=><p key={e.id}><b>{label(e.action)}</b> · {new Date(e.created_at).toLocaleString()}<small>{e.actor}</small></p>)}</section>
 </div><footer><button disabled={busy} onClick={close}>Close</button></footer></>}
 </dialog>
 </main>;
}
