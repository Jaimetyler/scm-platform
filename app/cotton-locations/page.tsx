"use client";
import {useEffect,useState} from "react";
import EquipmentEditor from "./EquipmentEditor";
import PolicyEditor from "./PolicyEditor";
import styles from "./page.module.css";
type Location={id:string;mcleod_code:string;prev_code:string|null;name:string;address:string|null;address2:string|null;city:string|null;state:string|null;zip_code:string|null;timezone:string|null;active:boolean;updated_at:string};
type Rule={rule_kind:string;fee_type:string;amount:number;grace_days:number|null;grace_unit:string|null};
type PolicyData={ok:boolean;error?:string;clues?:{id:string;source_type:string;source_reference:string;proposed_values:Record<string,unknown>;status:string}[];versions?:{id:string;status:string;source_type:string;source_reference:string|null;rules:Rule[]}[];schedules?:{weekday:number|null;open_time:string|null;close_time:string|null;checkin_cutoff:string|null;appointment_required:boolean|null;verified:boolean|null;source_reference:string|null}[]};
const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export default function CottonLocationsPage(){
 const [rows,setRows]=useState<Location[]>([]);
 const [selected,setSelected]=useState<Location|null>(null);
 const [policy,setPolicy]=useState<PolicyData|null>(null);
 const [policyBusy,setPolicyBusy]=useState(false);
 const [tab,setTab]=useState<"details"|"hours"|"fees"|"equipment">("details");
 const [query,setQuery]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){
  try{const res=await fetch("/api/cotton-locations",{cache:"no-store"});const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Unable to load locations");setRows(json.locations);}
  catch(e){setError(e instanceof Error?e.message:"Unable to load locations");}
 }
 useEffect(()=>{void load()},[]);
 useEffect(()=>{
  if(!selected)return;
  const handler=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)setSelected(null)};
  window.addEventListener("keydown",handler);
  return()=>window.removeEventListener("keydown",handler);
 },[selected,busy]);
 const filtered=rows.filter(r=>[r.mcleod_code,r.prev_code,r.name,r.address,r.city,r.state].some(x=>String(x||"").toLowerCase().includes(query.trim().toLowerCase())));
 async function openLocation(r:Location){
  setSelected({...r});setTab("details");setPolicy(null);setPolicyBusy(true);setError("");
  try{const res=await fetch("/api/cotton-locations/policies?location_id="+encodeURIComponent(r.id),{cache:"no-store"});const json=await res.json();setPolicy(res.ok?json:{ok:false,error:json.error||"Policy lookup failed"});}
  catch{setPolicy({ok:false,error:"Unable to retrieve policies"});}finally{setPolicyBusy(false);}
 }
 async function refreshPolicy(){
  if(!selected)return;
  const res=await fetch("/api/cotton-locations/policies?location_id="+encodeURIComponent(selected.id),{cache:"no-store"});
  const json=await res.json();
  if(!res.ok||!json.ok)throw Error("Saved, but policy refresh failed. Reopen this location to reload.");
  setPolicy(json);
 }
 async function save(){
  if(!selected)return;setBusy(true);setError("");setNotice("");
  try{
   const {id,updated_at,...rest}=selected;
   const res=await fetch("/api/cotton-locations",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,expectedUpdatedAt:updated_at,name:rest.name,address:rest.address,address2:rest.address2,city:rest.city,state:rest.state,zip_code:rest.zip_code,timezone:rest.timezone,prev_code:rest.prev_code,active:rest.active})});
   const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Save failed");
   setSelected(null);setNotice("Location saved and audited.");await load();
  }catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}
 }
 const field=(key:keyof Location,title:string)=><label className={styles.field}><span>{title}</span><input value={String(selected?.[key]??"")} onChange={e=>setSelected(v=>v?{...v,[key]:e.target.value}:v)}/></label>;
 return <main className={styles.page}>
  <div className={styles.heading}><div><h1>Cotton Location Management</h1><p>McLeod locations, pickup schedules and tariff policies</p></div><div><a href="/cotton-locations/outreach">Tariff outreach</a><p className={styles.count}>{rows.length} locations</p></div></div>
  <div className={styles.toolbar}><input aria-label="Search locations" placeholder="Search code, previous code, name or city" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>void load()}>Refresh</button></div>
  {error&&!selected&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{["McLeod code","Previous code","Location","Address","Status",""].map(x=><th key={x}>{x}</th>)}</tr></thead>
  <tbody>{filtered.map(r=><tr key={r.id}><td className={styles.code}>{r.mcleod_code}</td><td className={styles.code}>{r.prev_code||"—"}</td><td>{r.name||"Unnamed location"}</td><td>{[r.address,r.city,r.state,r.zip_code].filter(Boolean).join(", ")}</td><td>{r.active?"Active":"Unverified"}</td><td><button onClick={()=>void openLocation(r)}>View / Edit</button></td></tr>)}</tbody></table></div>
  {selected&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setSelected(null)}}>
   <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cotton-location-title">
    <header className={styles.modalHeader}><div><span className={styles.eyebrow}>COTTON LOCATION</span><h2 id="cotton-location-title">{selected.name||selected.mcleod_code}</h2><span className={styles.code}>{selected.mcleod_code} · Previous: {selected.prev_code||"Not recorded"}</span></div><button className={styles.close} aria-label="Close location" disabled={busy} onClick={()=>setSelected(null)}>×</button></header>
    <nav className={styles.tabs} aria-label="Location sections">{([["details","Location details"],["hours","Pickup hours"],["fees","Fee policies"],["equipment","Equipment"]] as const).map(([id,label])=><button key={id} className={tab===id?styles.activeTab:""} aria-current={tab===id?"page":undefined} disabled={busy} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div className={styles.modalBody}>
     {error&&<p role="alert" className={styles.error}>{error}</p>}
     {tab==="details"&&<div className={styles.form}>
      {field("name","Location name")}
      <div className={styles.twoCols}>{field("prev_code","Previous code")}{field("timezone","IANA timezone")}</div>
      {field("address","Street address")}{field("address2","McLeod address line 2 / notes")}
      <div className={styles.threeCols}>{field("city","City")}{field("state","State")}{field("zip_code","ZIP code")}</div>
      <label className={styles.checkbox}><input type="checkbox" checked={selected.active} onChange={e=>setSelected(v=>v?{...v,active:e.target.checked}:v)}/> Active location</label>
     </div>}
     {tab!=="details"&&policyBusy&&<p>Loading location policies…</p>}
     {tab!=="details"&&policy&&!policy.ok&&<p role="alert" className={styles.error}>{policy.error}</p>}
     {tab==="equipment"&&<div className={styles.policyList}><EquipmentEditor key={selected.id} locationId={selected.id} admin={true} onBusy={setBusy}/></div>}
     {tab==="hours"&&policy?.ok&&<div className={styles.policyList}>
      <p className={styles.helper}>Only source-confirmed hours should be treated as verified. Historical dispatcher defaults are not reliable.</p>
      {policy.clues?.filter(c=>c.proposed_values?.pickup_hours_clue).map(c=><article className={styles.policyCard} key={c.id}><strong>Unverified McLeod hours clue</strong><p>{String(c.proposed_values.pickup_hours_clue)}</p><small>Source: {c.source_reference}. Confirm before using for dispatch.</small></article>)}
      {policy.clues?.filter(c=>c.source_type==="tariff"&&c.proposed_values?.pickup_hours).map(c=><article className={styles.policyCard} key={c.id}><strong>Written tariff — pending review</strong><p>{JSON.stringify(c.proposed_values.pickup_hours)}</p><small>{c.source_reference}</small></article>)}
      {policy.schedules?.length?policy.schedules.map((v,i)=><article className={styles.policyCard} key={i}><strong>{v.weekday==null?"All days":days[v.weekday]}</strong><p>{v.open_time||"Hours unknown"} – {v.close_time||"Hours unknown"}</p><p>Check-in cutoff: {v.checkin_cutoff||"Not recorded"} · Appointment: {v.appointment_required===true?"Required":v.appointment_required===false?"Not required":"Unknown"}</p><small>{v.verified?"Verified":"Unverified"} · {v.source_reference||"No source"}</small></article>):<p>No pickup hours recorded.</p>}
      <PolicyEditor key={selected.id+"hours"} location={selected} kind="hours" onBusy={setBusy} onSaved={refreshPolicy}/>
     </div>}
     {tab==="fees"&&policy?.ok&&<div className={styles.policyList}>
      <p className={styles.helper}>Historical policies are drafts until reviewed. No changes here affect the active late-fee engine.</p>
      {policy.versions?.map(v=><article className={styles.policyCard} key={v.id}><strong>{v.status.toUpperCase()} · {v.source_type}</strong><small>{v.source_reference||"No source"}</small>{v.rules.map((rule,i)=><p key={i}>{rule.rule_kind.replace("_"," ")}: {rule.fee_type} · ${rule.amount} · Grace: {rule.grace_days??"Unknown"} {rule.grace_unit||""}</p>)}</article>)}
      <PolicyEditor key={selected.id+"fees"} location={selected} kind="fees" onBusy={setBusy} onSaved={refreshPolicy}/>
     </div>}
    </div>
    <footer className={styles.modalFooter}><button disabled={busy} onClick={()=>setSelected(null)}>Close</button>{tab==="details"&&<button className={styles.primary} disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save changes"}</button>}</footer>
   </section>
  </div>}
 </main>;
}
