"use client";
import {useEffect,useState} from "react";
type Location={id:string;mcleod_code:string;prev_code:string|null;name:string;address:string|null;address2:string|null;city:string|null;state:string|null;zip_code:string|null;timezone:string|null;active:boolean;updated_at:string};
type PolicyData={ok:boolean;error?:string;versions?:{id:string;status:string;source_type:string;source_reference:string|null;rules:{rule_kind:string;fee_type:string;amount:number;grace_days:number|null;grace_unit:string|null}[]}[];schedules?:{weekday:number|null;open_time:string|null;close_time:string|null;checkin_cutoff:string|null;appointment_required:boolean|null;verified:boolean|null;source_reference:string|null}[]};
export default function CottonLocationsPage(){
 const [rows,setRows]=useState<Location[]>([]),[selected,setSelected]=useState<Location|null>(null);
 const [policy,setPolicy]=useState<PolicyData|null>(null),[policyBusy,setPolicyBusy]=useState(false);
 const [query,setQuery]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){
  setError("");
  try{const res=await fetch("/api/cotton-locations",{cache:"no-store"});const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Unable to load");setRows(json.locations);}
  catch(e){setError(e instanceof Error?e.message:"Unable to load locations");}
 }
 useEffect(()=>{void load()},[]);
 const filtered=rows.filter(r=>[r.mcleod_code,r.prev_code,r.name,r.city,r.state].some(x=>String(x||"").toLowerCase().includes(query.toLowerCase())));
 async function openLocation(r:Location){setSelected({...r});setPolicy(null);setPolicyBusy(true);try{const res=await fetch("/api/cotton-locations/policies?location_id="+encodeURIComponent(r.id),{cache:"no-store"});const json=await res.json();setPolicy(res.ok?json:{ok:false,error:json.error||"Policy lookup failed"});}catch{setPolicy({ok:false,error:"Unable to retrieve policies"});}finally{setPolicyBusy(false);}}
 async function save(){
  if(!selected)return;setBusy(true);setError("");setNotice("");
  try{
   const {id,updated_at,...rest}=selected;
   const res=await fetch("/api/cotton-locations",{method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id,expectedUpdatedAt:updated_at,name:rest.name,address:rest.address,address2:rest.address2,city:rest.city,state:rest.state,zip_code:rest.zip_code,timezone:rest.timezone,prev_code:rest.prev_code,active:rest.active})});
   const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Save failed");
   setSelected(null);setNotice("Location saved and audited.");await load();
  }catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}
 }
 const field=(label:keyof Location,title:string)=><label style={{display:"grid",gap:4}}>{title}<input style={{padding:8}} value={String(selected?.[label]??"")} onChange={e=>setSelected(v=>v?{...v,[label]:e.target.value}:v)}/></label>;
 return <main style={{maxWidth:1200,margin:"30px auto",padding:20,fontFamily:"system-ui"}}>
 <h1>Cotton Location Management</h1>
 <p>Maintain approved McLeod locations. Pickup schedules, tariff versions and document uploads will be added to this workspace. Changes are restricted to administrators.</p>
 <input aria-label="Search locations" placeholder="Search code, name, city..." value={query} onChange={e=>setQuery(e.target.value)} style={{padding:10,width:"min(100%,440px)"}}/>
 <button onClick={()=>void load()} style={{marginLeft:10,padding:10}}>Refresh</button>
 {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}{notice&&<p role="status">{notice}</p>}
 <p>{filtered.length} locations</p>
 <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
 <thead><tr>{["McLeod Code","Previous Code","Name","Address","Active","Action"].map(x=><th key={x} style={{textAlign:"left",padding:10,borderBottom:"1px solid #999"}}>{x}</th>)}</tr></thead>
 <tbody>{filtered.map(r=><tr key={r.id}><td>{r.mcleod_code}</td><td>{r.prev_code||"—"}</td><td>{r.name}</td><td>{r.address}, {r.city}, {r.state} {r.zip_code}</td><td>{r.active?"Yes":"No"}</td><td><button onClick={()=>void openLocation(r)}>Edit</button></td></tr>)}</tbody>
 </table></div>
 {selected&&<div role="presentation" style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.62)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}><section role="dialog" aria-modal="true" aria-label={`Location ${selected.mcleod_code}`} style={{background:"var(--background, #fff)",color:"var(--foreground, #111)",width:"min(100%,780px)",maxHeight:"min(90vh,900px)",overflowY:"auto",border:"1px solid #aaa",borderRadius:12,padding:20,display:"grid",gap:12,boxShadow:"0 16px 50px rgba(0,0,0,.35)"}}>
 <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,position:"sticky",top:-20,padding:"12px 0",background:"var(--background, #fff)",zIndex:1,borderBottom:"1px solid #aaa"}}><h2 style={{margin:0}}>Location {selected.mcleod_code}</h2><button type="button" aria-label="Close location details" disabled={busy} onClick={()=>setSelected(null)}>Close ×</button></div>
 {field("name","Name")}{field("prev_code","Previous code")}{field("address","Street address")}{field("address2","McLeod address line 2 / notes")}
 <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{field("city","City")}{field("state","State")}</div>{field("zip_code","ZIP code")}
 {field("timezone","IANA timezone")}
 <div style={{borderTop:"1px solid #aaa",paddingTop:12}}><h3>Pickup schedules & fee policies</h3><p>Current policy values are displayed for review. Editing and tariff approvals are not enabled yet.</p>{policyBusy&&<p>Loading policies...</p>}{policy&&!policy.ok&&<p role="alert">{policy.error}</p>}{policy?.ok&&<><h4>Pickup schedules</h4>{policy.schedules?.length?policy.schedules.map((v,i)=><p key={i}>{v.weekday===null?"All days":`Weekday ${v.weekday}`}: {v.open_time||"Unknown"}–{v.close_time||"Unknown"} · Appointment: {v.appointment_required===true?"Required":v.appointment_required===false?"Not required":"Unknown"} · {v.verified?"Verified":"Unverified"} · {v.source_reference||"No source"}</p>):<p>No confirmed pickup hours recorded.</p>}<h4>Fee policies</h4>{policy.versions?.map(v=><div key={v.id} style={{padding:10,marginBottom:8,border:"1px solid #bbb",borderRadius:8}}><strong>{v.status.toUpperCase()}</strong> · {v.source_type} · {v.source_reference||"No source"}{v.rules.map((rule,i)=><p key={i}>{rule.rule_kind}: {rule.fee_type} · ${rule.amount} · Grace: {rule.grace_days??"Unknown"} {rule.grace_unit||""}</p>)}</div>)}</>}</div>
 <label><input type="checkbox" checked={selected.active} onChange={e=>setSelected(v=>v?{...v,active:e.target.checked}:v)}/> Active</label>
 <div><button disabled={busy} onClick={()=>void save()}>{busy?"Saving...":"Save changes"}</button><button disabled={busy} onClick={()=>setSelected(null)} style={{marginLeft:10}}>Cancel</button></div>
 </section></div>}
 </main>;
}
