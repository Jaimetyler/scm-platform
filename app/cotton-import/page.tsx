"use client";
import { useState } from "react";

type Review = { salesOrder:string;status:string;reason:string;pickupWindows?:{locationCode:string;originalRtlDate:string;early:string|null;late:string|null;status:string;reason:string}[];pickupPolicies?:{locationCode:string;versions:{status:string;rules:{rule_kind:string;fee_type:string;amount:number;grace_days:number}[]}[]}[];preview?:{blnum:string;pickupStops:{locationCode:string;scheduledDate:string}[]} };
type Result = { ok:boolean;error?:string;filename?:string;destination?:string;counts?:{orders:number;pickupLines:number;blocked:number;sourceErrors:number};reviews?:Review[];sourceErrors?:{row:number;reason:string}[] };
export default function CottonImportPage() {
 const [file,setFile]=useState<File|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);
 async function preview() {
  if(!file)return;
  setBusy(true);setResult(null);setSelected([]);
  try {
   const form=new FormData();form.set("file",file);
   const response=await fetch("/api/cotton-import/upload",{method:"POST",body:form});
   const data=await response.json();
   setResult(response.ok?data:{ok:false,error:data.error||"Preview failed"});
  }catch(error){setResult({ok:false,error:error instanceof Error?error.message:"Network error"});}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:1100,margin:"36px auto",padding:20,fontFamily:"system-ui"}}>
  <h1>Domestic cotton import</h1>
  <p>Bunge (BUNGOMNE) dispatch preview for Savannah and Houston Baytown. McLeod creation is not enabled yet.</p>
  <label>Dispatch Excel workbook <input type="file" accept=".xls,.xlsx" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
  <button type="button" disabled={!file||busy} onClick={preview} style={{marginLeft:16,padding:10}}>{busy?"Checking...":"Preview dispatch"}</button>
  {result&&!result.ok&&<p role="alert" style={{color:"crimson"}}>{result.error}</p>}
  {result?.ok&&<section>
   <h2>{result.destination}</h2>
   <p>{result.counts?.orders} grouped orders · {result.counts?.pickupLines} pickup lines · {result.counts?.blocked} blocked · {result.counts?.sourceErrors} source errors</p>
   <p><strong>Review only.</strong> No creation, duplicate lookup, or delivery is enabled.</p>
   <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
    <button type="button" onClick={()=>setSelected(result.reviews?.filter(r=>r.status!=="blocked").map(r=>r.salesOrder)||[])}>Select available</button>
    <button type="button" onClick={()=>setSelected([])}>Clear selection</button>
    <strong>{selected.length} selected</strong>
    <button type="button" disabled title="Creation requires a verified McLeod write integration">Create selected orders (not yet enabled)</button>
   </div>

   <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
    <thead><tr>{["Select","Sales order","BLNUM","Pickup locations","RTL / scheduled window","Late-fee policy","Status","Reason"].map(h=><th key={h} style={{padding:8,textAlign:"left",borderBottom:"1px solid gray"}}>{h}</th>)}</tr></thead>
    <tbody>{result.reviews?.map((r,i)=><tr key={i}><td><input type="checkbox" aria-label={`Select SO ${r.salesOrder}`} disabled={r.status==="blocked"} checked={selected.includes(r.salesOrder)} onChange={e=>setSelected(current=>e.target.checked?[...current,r.salesOrder]:current.filter(x=>x!==r.salesOrder))}/></td><td>{r.salesOrder}</td><td>{r.preview?.blnum||"—"}</td><td>{r.preview?.pickupStops.map(s=>s.locationCode).join(", ")||"—"}</td><td>{r.pickupWindows?.map((w,j)=><div key={j}>{w.locationCode}: {w.originalRtlDate} · {w.early||"?"}–{w.late||"?"} ({w.status})</div>)||"—"}</td><td>{r.pickupPolicies?.map((p,j)=><div key={j}>{p.locationCode}: {p.versions.length?p.versions.flatMap(v=>v.rules.filter(x=>x.rule_kind==="late_pickup").map(x=>`${x.fee_type} ${x.amount} / ${x.grace_days} grace days (${v.status})`)).join("; ")||"No late pickup rule":"No policy"}</div>)||"—"}</td><td>{r.status}</td><td>{r.reason}</td></tr>)}</tbody>
   </table></div>
  </section>}
 </main>;
}
