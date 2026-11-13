"use client";
import MileageEvidence from "@/components/warehouse/MileageEvidence";
import {useEffect,useRef,useState} from "react";
import { canEditCottonLocationDetails } from "@/lib/auth/policy";
import { useStaff } from "@/components/auth/StaffSession";
import type { ExistingTariff } from "@/lib/cotton-locations/existing-tariffs";
import TariffDocuments, { type TariffDocument } from "./TariffDocuments";
import EquipmentEditor from "./EquipmentEditor";
import PolicyEditor from "./PolicyEditor";
import styles from "./page.module.css";
type Location={id:string;mcleod_code:string;prev_code:string|null;name:string;address:string|null;address2:string|null;city:string|null;state:string|null;zip_code:string|null;timezone:string|null;active:boolean;updated_at:string};
type Rule={rule_kind:string;fee_type:string;amount:number;grace_days:number|null;grace_unit:string|null};
type PickupHours={weekday:number|null;open_time:string|null;close_time:string|null;checkin_cutoff:string|null;appointment_required:boolean|null;verified:boolean|null;source_reference:string|null;effective_from:string|null;effective_to:string|null};
type PolicyData={ok:boolean;contact?:{contact_name:string;contact_phone:string;contact_email:string}|null;documents?:TariffDocument[];existingTariffs?:ExistingTariff[];error?:string;clues?:{id:string;source_type:string;source_reference:string;proposed_values:Record<string,unknown>;status:string}[];versions?:{id:string;status:string;source_type:string;source_reference:string|null;rules:Rule[]}[];schedules?:PickupHours[]};
const days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const orderedDays=[1,2,3,4,5,6,0];
function formatHour(time:string|null){
 if(!time)return "Unknown";
 const [hour,minute]=time.split(":");
 const h=Number(hour);
 return `${h%12||12}:${minute} ${h<12?"AM":"PM"}`;
}
export default function CottonLocationsPage(){
 const staff=useStaff();
 const canEditDetails=canEditCottonLocationDetails(staff);
 const admin=staff?.role==="admin", canWrite=staff?.status==="active"&&staff.role!=="accounting";
 const selectionVersion=useRef(0);
 const [rows,setRows]=useState<Location[]>([]);
 const [selected,setSelected]=useState<Location|null>(null);
 const [policy,setPolicy]=useState<PolicyData|null>(null);
 const [editingHours,setEditingHours]=useState<{day:number;verify:boolean}|null>(null);
 const [policyBusy,setPolicyBusy]=useState(false);
 const [tab,setTab]=useState<"details"|"hours"|"fees"|"tariffs"|"equipment"|"mileage">("details");
 const [query,setQuery]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(): Promise<Location[] | undefined>{
  try{const res=await fetch("/api/cotton-locations",{cache:"no-store"});const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Unable to load locations");setRows(json.locations);return json.locations;}
  catch(e){setError(e instanceof Error?e.message:"Unable to load locations");}
 }
 useEffect(() => {
  const code = new URLSearchParams(window.location.search).get("location")?.trim().toUpperCase();
  void load().then(locations => {
   if (!code || !locations) return;
   setQuery(code);
   const current = locations.filter(r => r.mcleod_code.trim().toUpperCase() === code);
   const matches = current.length ? current : locations.filter(r => r.prev_code?.trim().toUpperCase() === code);
   if (matches.length === 1) void openLocation(matches[0]);
   else setNotice(matches.length ? "Multiple locations match this code. Choose the correct record." : "No location record matches this code.");
  });
 }, []);
 useEffect(()=>{
  if(!selected)return;
  const handler=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)setSelected(null)};
  window.addEventListener("keydown",handler);
  return()=>window.removeEventListener("keydown",handler);
 },[selected,busy]);
 const filtered=rows.filter(r=>[r.mcleod_code,r.prev_code,r.name,r.address,r.city,r.state].some(x=>String(x||"").toLowerCase().includes(query.trim().toLowerCase())));
 async function openLocation(r:Location){
  const version=++selectionVersion.current;
  setSelected({...r});setTab("details");setEditingHours(null);setPolicy(null);setPolicyBusy(true);setError("");
  try{const res=await fetch("/api/cotton-locations/policies?location_id="+encodeURIComponent(r.id),{cache:"no-store"});const json=await res.json();if(version===selectionVersion.current)setPolicy(res.ok?json:{ok:false,error:json.error||"Policy lookup failed"});}
  catch{if(version===selectionVersion.current)setPolicy({ok:false,error:"Unable to retrieve policies"});}finally{if(version===selectionVersion.current)setPolicyBusy(false);}
 }
 async function refreshPolicy(){
  if(!selected)return;
  const res=await fetch("/api/cotton-locations/policies?location_id="+encodeURIComponent(selected.id),{cache:"no-store"});
  const json=await res.json();
  if(!res.ok||!json.ok)throw Error("Saved, but policy refresh failed. Reopen this location to reload.");
  setPolicy(json);
 }
 async function save(){
  if(!selected||!canEditDetails)return;setBusy(true);setError("");setNotice("");
  try{
   const {id,updated_at,...rest}=selected;
   const res=await fetch("/api/cotton-locations",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,expectedUpdatedAt:updated_at,name:rest.name,address:rest.address,address2:rest.address2,city:rest.city,state:rest.state,zip_code:rest.zip_code,timezone:rest.timezone,prev_code:rest.prev_code,active:rest.active})});
   const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Save failed");
   setSelected(null);setNotice("Location saved and audited.");await load();
  }catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}
 }
 const today=(()=>{try{return new Intl.DateTimeFormat("en-CA",{timeZone:selected?.timezone||"America/New_York"}).format(new Date());}
 catch{return new Date().toISOString().slice(0,10);}})();
 const currentHours=(policy?.schedules??[]).filter(row=>(!row.effective_from||row.effective_from<=today)&&(!row.effective_to||row.effective_to>=today));
 const field=(key:keyof Location,title:string)=><label className={styles.field}><span>{title}</span><input value={String(selected?.[key]??"")} onChange={e=>setSelected(v=>v?{...v,[key]:e.target.value}:v)}/></label>;
 return <main className={styles.page}>
  <div className={styles.heading}><div><h1>Cotton Location Management</h1><p>McLeod locations, pickup schedules and tariff policies</p></div><div><p className={styles.count}>{rows.length} locations</p></div></div>
  <div className={styles.toolbar}><input aria-label="Search locations" placeholder="Search McLeod code, EWR warehouse code, name or city" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>void load()}>Refresh</button></div>
  {error&&!selected&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{["McLeod code","EWR Warehouse Code","Location","Address","Status",""].map(x=><th key={x}>{x}</th>)}</tr></thead>
  <tbody>{filtered.map(r=><tr key={r.id}><td className={styles.code}>{r.mcleod_code}</td><td className={styles.code}>{r.prev_code||"—"}</td><td>{r.name||"Unnamed location"}</td><td>{[r.address,r.city,r.state,r.zip_code].filter(Boolean).join(", ")}</td><td>{r.active?"Active":"Unverified"}</td><td><button onClick={()=>void openLocation(r)}>{canEditDetails?"View / Edit":"Open location"}</button></td></tr>)}</tbody></table></div>
  {selected&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setSelected(null)}}>
   <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cotton-location-title">
    <header className={styles.modalHeader}><div><span className={styles.eyebrow}>COTTON LOCATION</span><h2 id="cotton-location-title">{selected.name||selected.mcleod_code}</h2><span className={styles.code}>{selected.mcleod_code} · EWR Warehouse Code: {selected.prev_code||"Not recorded"}</span></div><button className={styles.close} aria-label="Close location" disabled={busy} onClick={()=>setSelected(null)}>×</button></header>
    <nav className={styles.tabs} aria-label="Location sections">{([["details","Location details"],["hours","Pickup hours"],["fees","Fee policies"],["tariffs","Tariff documents"],["equipment","Equipment"],["mileage","Routing miles"]] as const).map(([id,label])=><button key={id} className={tab===id?styles.activeTab:""} aria-current={tab===id?"page":undefined} disabled={busy} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div className={styles.modalBody}>
     {error&&<p role="alert" className={styles.error}>{error}</p>}
     {tab==="details"&&<fieldset className={styles.form} disabled={!canEditDetails}>
      {field("name","Location name")}
      <div className={styles.twoCols}>{field("prev_code","EWR Warehouse Code")}{field("timezone","IANA timezone")}</div>
      {field("address","Street address")}{field("address2","McLeod address line 2 / notes")}
      <div className={styles.threeCols}>{field("city","City")}{field("state","State")}{field("zip_code","ZIP code")}</div>
      <label className={styles.checkbox}><input type="checkbox" checked={selected.active} onChange={e=>setSelected(v=>v?{...v,active:e.target.checked}:v)}/> Active location</label>
     </fieldset>}
     {tab!=="details"&&tab!=="mileage"&&policyBusy&&<p>Loading location policies…</p>}
     {tab!=="details"&&tab!=="mileage"&&policy&&!policy.ok&&<p role="alert" className={styles.error}>{policy.error}</p>}
     {tab==="mileage"&&<MileageEvidence key={selected.id} locationId={selected.id}/>}
     {tab==="equipment"&&<div className={styles.policyList}><EquipmentEditor key={selected.id} locationId={selected.id} admin={admin} canWrite={admin||staff?.role==="operator"} onBusy={setBusy}/></div>}
     {["hours","fees","tariffs"].includes(tab)&&policy?.contact&&<p className={styles.helper}>
      {[policy.contact.contact_name,policy.contact.contact_phone,policy.contact.contact_email].filter(Boolean).join(" · ")}
     </p>}
     {tab==="tariffs"&&policy?.ok&&<TariffDocuments key={selected.id} locationId={selected.id}
      documents={policy.documents??[]} existingTariffs={policy.existingTariffs??[]}
      canWrite={canWrite} onBusy={setBusy} onSaved={refreshPolicy}/>}
     {tab==="hours"&&policy?.ok&&<div className={styles.policyList}>
      <p className={styles.helper}>Local pickup hours{selected.timezone?` · ${selected.timezone}`:" · Timezone missing"}</p>
      <ul className={styles.hoursList}>
       {orderedDays.map(day=>{
        const specific=currentHours.filter(row=>row.weekday===day);
        const schedules=specific.length?specific:currentHours.filter(row=>row.weekday===null);
        const row=schedules.length===1?schedules[0]:undefined;
        return <li key={day}>
         <div className={styles.hoursRow}>
          <strong>{days[day]}</strong>
          <div>
           <span>{row?.open_time&&row.close_time?`${formatHour(row.open_time)} – ${formatHour(row.close_time)}`:schedules.length>1?"Multiple schedules · review required":row?.appointment_required?"By appointment":"Hours not recorded"}</span>
           {row&&<small>{row.verified?"Verified":"Unverified"}{row.checkin_cutoff?` · Cutoff ${formatHour(row.checkin_cutoff)}`:""}{row.appointment_required===true?" · Appointment required":row.appointment_required===false?" · No appointment":""}</small>}
          </div>
          {canWrite&&<div className={styles.hoursActions}>
           {row&&!row.verified&&((row.open_time&&row.close_time)||row.appointment_required===true)&&
            <button type="button" disabled={busy} aria-label={`Verify ${days[day]} pickup hours`} onClick={()=>setEditingHours({day,verify:true})}>Verify</button>}
           <button type="button" disabled={busy} aria-label={`Edit ${days[day]} pickup hours`} onClick={()=>setEditingHours({day,verify:false})}>Edit</button>
          </div>}
         </div>
         {editingHours?.day===day&&canWrite&&<div className={styles.hoursEditor}>
          <PolicyEditor key={`${selected.id}-${day}-${editingHours.verify}`} location={selected} kind="hours" hoursSeed={{...row,day}} verifyHours={editingHours.verify}
           onBusy={setBusy} onCancel={()=>setEditingHours(null)}
           onSaved={async()=>{await refreshPolicy();setEditingHours(null);}}/>
         </div>}
        </li>;
       })}
      </ul>
      {!!policy.clues?.some(clue=>clue.proposed_values?.pickup_hours_clue||clue.source_type==="tariff"&&clue.proposed_values?.pickup_hours)&&<details>
       <summary>Hours source notes</summary>
       {policy.clues.filter(clue=>clue.proposed_values?.pickup_hours_clue||clue.source_type==="tariff"&&clue.proposed_values?.pickup_hours).map(clue=><p className={styles.helper} key={clue.id}>
        {String(clue.proposed_values.pickup_hours_clue??JSON.stringify(clue.proposed_values.pickup_hours))} · {clue.source_reference} · Pending confirmation
       </p>)}
      </details>}
     </div>}
     {tab==="fees"&&policy?.ok&&<div className={styles.policyList}>
      <p className={styles.helper}>Historical policies are drafts until reviewed. No changes here affect the active late-fee engine.</p>
      {policy.versions?.map(v=><article className={styles.policyCard} key={v.id}><strong>{v.status.toUpperCase()} · {v.source_type}</strong><small>{v.source_reference||"No source"}</small>{v.rules.map((rule,i)=><p key={i}>{rule.rule_kind.replace("_"," ")}: {rule.fee_type} · ${rule.amount} · Grace: {rule.grace_days??"Unknown"} {rule.grace_unit||""}</p>)}</article>)}
      {canWrite&&<PolicyEditor key={selected.id+"fees"} location={selected} kind="fees" onBusy={setBusy} onSaved={refreshPolicy}/>}
     </div>}
    </div>
    <footer className={styles.modalFooter}><button disabled={busy} onClick={()=>setSelected(null)}>Close</button>{tab==="details"&&canEditDetails&&<button className={styles.primary} disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save changes"}</button>}</footer>
   </section>
  </div>}
 </main>;
}
