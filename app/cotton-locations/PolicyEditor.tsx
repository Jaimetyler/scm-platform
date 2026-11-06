"use client";
import {useState} from "react";
type HoursSeed = {day:number;open_time?:string|null;close_time?:string|null;checkin_cutoff?:string|null;appointment_required?:boolean|null};
const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
type Props={location?:{id:string;mcleod_code:string;name:string};kind?:"hours"|"fees";onSaved?:()=>Promise<void>;onBusy?:(busy:boolean)=>void;hoursSeed?:HoursSeed;verifyHours?:boolean;onCancel?:()=>void};
export default function CottonPolicyEditor({location,kind:initialKind,onSaved,onBusy,hoursSeed,verifyHours=false,onCancel}:Props){
 const [code,setCode]=useState(""),[locationId,setLocationId]=useState(location?.id||""),[source,setSource]=useState("");
 const [kind,setKind]=useState<"hours"|"fees">(initialKind||"hours"),[days,setDays]=useState(hoursSeed ? [hoursSeed.day] : [1,2,3,4,5]);
 const [open,setOpen]=useState(hoursSeed?.open_time?.slice(0,5)??""),[close,setClose]=useState(hoursSeed?.close_time?.slice(0,5)??""),[cutoff,setCutoff]=useState(hoursSeed?.checkin_cutoff?.slice(0,5)??"");
 const [appt,setAppt]=useState<boolean|null>(hoursSeed ? hoursSeed.appointment_required??null : false),[verified,setVerified]=useState(verifyHours);
 const [effective,setEffective]=useState(()=>[new Date().getFullYear(),String(new Date().getMonth()+1).padStart(2,"0"),String(new Date().getDate()).padStart(2,"0")].join("-")),[lateType,setLateType]=useState("NONE"),[lateAmount,setLateAmount]=useState(0),[grace,setGrace]=useState(0),[earlyType,setEarlyType]=useState("NONE"),[earlyAmount,setEarlyAmount]=useState(0);
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function find(){
 setMessage("");const r=await fetch("/api/cotton-locations");const j=await r.json();
 const found=j.locations?.find((x:any)=>x.mcleod_code?.toUpperCase()===code.trim().toUpperCase());
 if(!found){setLocationId("");setMessage("Location not found.");return}
 setLocationId(found.id);setMessage(found.name+" — "+found.mcleod_code);
 }
 async function save(){
 setBusy(true);onBusy?.(true);try{
 const payload=kind==="hours"?{kind,locationId,days,openTime:open||null,closeTime:close||null,cutoffTime:cutoff||null,appointmentRequired:appt,verified,source}:{kind,locationId,source,effectiveFrom:effective,rules:[{rule_kind:"late_pickup",fee_type:lateType,amount:lateAmount,grace_days:grace},{rule_kind:"early_pickup",fee_type:earlyType,amount:earlyAmount}]};
 const r=await fetch("/api/cotton-locations/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
 const j=await r.json();
 if(!r.ok||!j.ok)throw Error(j.error||"Save failed");
 setMessage(kind==="hours"?"Schedule evidence saved with audit history.":"Fee-policy draft saved with audit history.");
 await onSaved?.();
 }catch(e){setMessage(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);onBusy?.(false)}
 }
 const inputStyle={padding:9};
 const feeTypes=["NONE","FLAT","PER_DAY","PER_BALE_ONE_TIME","PER_BALE_PER_DAY","NOT_ALLOWED","CUSTOM"];
 return <section style={location?{display:"grid",gap:14}:{maxWidth:800,margin:"30px auto",padding:20,fontFamily:"system-ui"}}>
 {!location&&<><h1>Cotton pickup hours & fee policies</h1><p>Admin-only manual review. Historical fee calculations remain unchanged.</p></>}
 {location&&<h3>{kind==="hours"?(verifyHours?"Verify pickup hours":"Record reviewed pickup hours"):"Create revised early / late fee draft"}</h3>}
 {!location&&<>
 <label>McLeod location code <input style={inputStyle} value={code} onChange={e=>setCode(e.target.value)}/></label>
 <button onClick={()=>void find()}>Find location</button></>}
 {message&&<p role="status">{message}</p>}
 {locationId&&<fieldset disabled={busy} style={{display:"grid",gap:14,border:0,padding:0,margin:0}}>
 {!initialKind&&<label>Update type <select value={kind} onChange={e=>setKind(e.target.value as "hours"|"fees")}><option value="hours">Pickup hours / appointment</option><option value="fees">Early & late fee draft</option></select></label>}
 {kind==="hours"?<>
 <div>{[1,2,3,4,5,6,0].map(i=><label key={i} style={{marginRight:10}}><input type="checkbox" checked={days.includes(i)} onChange={e=>setDays(v=>e.target.checked?[...v,i]:v.filter(x=>x!==i))}/>{weekdays[i]}</label>)}</div>
 <label>Opening time <input type="time" value={open} onChange={e=>setOpen(e.target.value)}/></label>
 <label>Closing time <input type="time" value={close} onChange={e=>setClose(e.target.value)}/></label>
 <label>Check-in cutoff <input type="time" value={cutoff} onChange={e=>setCutoff(e.target.value)}/></label>
 <label>Appointment <select value={appt===null?"":appt?"required":"not-required"} onChange={e=>setAppt(e.target.value===""?null:e.target.value==="required")}>
  <option value="">Choose appointment requirement</option><option value="not-required">Not required</option><option value="required">Required</option>
 </select></label>
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
 <button disabled={busy||!source.trim()||(kind==="hours"&&(!days.length||appt===null||(!appt&&(!open||!close))))} onClick={()=>void save()}>{busy?"Saving...":kind==="hours"?(verified?"Save verified hours":"Save hours"):"Save fee draft"}</button>
 {onCancel&&<button type="button" onClick={onCancel}>Cancel</button>}
 </fieldset>}
 </section>
}
