"use client";
import {useState} from "react";
export default function CottonPolicyEditor(){
 const [code,setCode]=useState(""),[locationId,setLocationId]=useState(""),[source,setSource]=useState("");
 const [kind,setKind]=useState<"hours"|"fees">("hours"),[days,setDays]=useState([1,2,3,4,5]);
 const [open,setOpen]=useState("07:00"),[close,setClose]=useState("15:00"),[cutoff,setCutoff]=useState("");
 const [appt,setAppt]=useState(false),[verified,setVerified]=useState(false);
 const [effective,setEffective]=useState("2026-11-02"),[lateType,setLateType]=useState("NONE"),[lateAmount,setLateAmount]=useState(0),[grace,setGrace]=useState(0),[earlyType,setEarlyType]=useState("NONE"),[earlyAmount,setEarlyAmount]=useState(0);
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function find(){
 setMessage("");const r=await fetch("/api/cotton-locations");const j=await r.json();
 const found=j.locations?.find((x:any)=>x.mcleod_code?.toUpperCase()===code.trim().toUpperCase());
 if(!found){setLocationId("");setMessage("Location not found.");return}
 setLocationId(found.id);setMessage(found.name+" — "+found.mcleod_code);
 }
 async function save(){
 setBusy(true);try{
 const payload=kind==="hours"?{kind,locationId,days,openTime:open,closeTime:close,cutoffTime:cutoff||null,appointmentRequired:appt,verified,source}:{kind,locationId,source,effectiveFrom:effective,rules:[{rule_kind:"late_pickup",fee_type:lateType,amount:lateAmount,grace_days:grace},{rule_kind:"early_pickup",fee_type:earlyType,amount:earlyAmount}]};
 const r=await fetch("/api/cotton-locations/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
 const j=await r.json();setMessage(r.ok&&j.ok?"Saved with audit history. Fee changes remain drafts.":j.error||"Save failed");
 }catch{setMessage("Save failed");}finally{setBusy(false)}
 }
 const inputStyle={padding:9};
 const feeTypes=["NONE","FLAT","PER_DAY","PER_BALE_ONE_TIME","PER_BALE_PER_DAY","NOT_ALLOWED","CUSTOM"];
 return <main style={{maxWidth:800,margin:"30px auto",padding:20,fontFamily:"system-ui"}}>
 <h1>Cotton pickup hours & fee policies</h1><p>Admin-only manual review. Historical fee calculations remain unchanged.</p>
 <label>McLeod location code <input style={inputStyle} value={code} onChange={e=>setCode(e.target.value)}/></label>
 <button onClick={()=>void find()}>Find location</button>
 {message&&<p role="status">{message}</p>}
 {locationId&&<section style={{display:"grid",gap:14,marginTop:22}}>
 <label>Update type <select value={kind} onChange={e=>setKind(e.target.value as "hours"|"fees")}><option value="hours">Pickup hours / appointment</option><option value="fees">Early & late fee draft</option></select></label>
 {kind==="hours"?<>
 <div>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><label key={d} style={{marginRight:10}}><input type="checkbox" checked={days.includes(i)} onChange={e=>setDays(v=>e.target.checked?[...v,i]:v.filter(x=>x!==i))}/>{d}</label>)}</div>
 <label>Opening time <input type="time" value={open} onChange={e=>setOpen(e.target.value)}/></label>
 <label>Closing time <input type="time" value={close} onChange={e=>setClose(e.target.value)}/></label>
 <label>Check-in cutoff <input type="time" value={cutoff} onChange={e=>setCutoff(e.target.value)}/></label>
 <label><input type="checkbox" checked={appt} onChange={e=>setAppt(e.target.checked)}/> Appointment required</label>
 <label><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> Hours confirmed by source</label>
 </>:<>
 <label>Effective date <input type="date" value={effective} onChange={e=>setEffective(e.target.value)}/></label>
 <label>Late fee type <select value={lateType} onChange={e=>setLateType(e.target.value)}>{feeTypes.map(t=><option key={t}>{t}</option>)}</select></label>
 <label>Late fee amount <input type="number" min="0" step="0.01" value={lateAmount} onChange={e=>setLateAmount(Number(e.target.value))}/></label>
 <label>Late grace days <input type="number" min="0" value={grace} onChange={e=>setGrace(Number(e.target.value))}/></label>
 <label>Early fee type <select value={earlyType} onChange={e=>setEarlyType(e.target.value)}>{feeTypes.map(t=><option key={t}>{t}</option>)}</select></label>
 <label>Early fee amount <input type="number" min="0" step="0.01" value={earlyAmount} onChange={e=>setEarlyAmount(Number(e.target.value))}/></label>
 </>}
 <label>Source / person / tariff reference <input style={{...inputStyle,width:"100%"}} value={source} onChange={e=>setSource(e.target.value)}/></label>
 <button disabled={busy||!source.trim()||!days.length} onClick={()=>void save()}>{busy?"Saving...":kind==="hours"?"Save schedule evidence":"Save fee draft"}</button>
 </section>}
 </main>
}
