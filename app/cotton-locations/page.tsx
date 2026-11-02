"use client";
import {useEffect,useState} from "react";
type Location={id:string;mcleod_code:string;prev_code:string|null;name:string;address:string|null;city:string|null;state:string|null;timezone:string|null;active:boolean;updated_at:string};
export default function CottonLocationsPage(){
 const [rows,setRows]=useState<Location[]>([]),[selected,setSelected]=useState<Location|null>(null);
 const [query,setQuery]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){
  setError("");
  try{const res=await fetch("/api/cotton-locations",{cache:"no-store"});const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||"Unable to load");setRows(json.locations);}
  catch(e){setError(e instanceof Error?e.message:"Unable to load locations");}
 }
 useEffect(()=>{void load()},[]);
 const filtered=rows.filter(r=>[r.mcleod_code,r.prev_code,r.name,r.city,r.state].some(x=>String(x||"").toLowerCase().includes(query.toLowerCase())));
 async function save(){
  if(!selected)return;setBusy(true);setError("");setNotice("");
  try{
   const {id,updated_at,...rest}=selected;
   const res=await fetch("/api/cotton-locations",{method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id,expectedUpdatedAt:updated_at,name:rest.name,address:rest.address,city:rest.city,state:rest.state,timezone:rest.timezone,prev_code:rest.prev_code,active:rest.active})});
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
 <thead><tr>{["Code","Name","City / State","Active","Action"].map(x=><th key={x} style={{textAlign:"left",padding:10,borderBottom:"1px solid #999"}}>{x}</th>)}</tr></thead>
 <tbody>{filtered.map(r=><tr key={r.id}><td>{r.mcleod_code}</td><td>{r.name}</td><td>{r.city}, {r.state}</td><td>{r.active?"Yes":"No"}</td><td><button onClick={()=>setSelected({...r})}>Edit</button></td></tr>)}</tbody>
 </table></div>
 {selected&&<section style={{marginTop:24,border:"1px solid #aaa",borderRadius:12,padding:20,display:"grid",gap:12}}>
 <h2>Edit {selected.mcleod_code}</h2>
 {field("name","Name")}{field("prev_code","Previous code")}{field("address","Address")}
 <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{field("city","City")}{field("state","State")}</div>
 {field("timezone","IANA timezone")}
 <label><input type="checkbox" checked={selected.active} onChange={e=>setSelected(v=>v?{...v,active:e.target.checked}:v)}/> Active</label>
 <div><button disabled={busy} onClick={()=>void save()}>{busy?"Saving...":"Save changes"}</button><button disabled={busy} onClick={()=>setSelected(null)} style={{marginLeft:10}}>Cancel</button></div>
 </section>}
 </main>;
}
