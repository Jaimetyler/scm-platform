"use client";
import { useState } from "react";

type Review = { salesOrder:string;status:string;reason:string;pickupWindows?:{locationCode:string;originalRtlDate:string;early:string|null;late:string|null;status:string;reason:string}[];pickupPolicies?:{locationCode:string;versions:{status:string;rules:{rule_kind:string;fee_type:string;amount:number;grace_days:number}[]}[]}[];preview?:{blnum:string;pickupStops:{locationCode:string;scheduledDate:string}[]} };
type Result = { ok:boolean;error?:string;filename?:string;destination?:string;counts?:{orders:number;pickupLines:number;blocked:number;sourceErrors:number};reviews?:Review[];sourceErrors?:{row:number;reason:string}[] };
export default function CottonImportPage() {
 const [file,setFile]=useState<File|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);
 const [preflightResult,setPreflightResult]=useState<string>("");
 const [preflightDetails,setPreflightDetails]=useState<string>("");
 async function preview() {
  if(!file)return;
  setBusy(true);setResult(null);setSelected([]);setPreflightResult("");setPreflightDetails("");
  try {
   const form=new FormData();form.set("file",file);
   const response=await fetch("/api/cotton-import/upload",{method:"POST",body:form});
   const data=await response.json();
   setResult(response.ok?data:{ok:false,error:data.error||"Preview failed"});
  }catch(error){setResult({ok:false,error:error instanceof Error?error.message:"Network error"});}
  finally{setBusy(false);}
 }
 async function preflight(){
  if(!file||selected.length!==1)return;
  setBusy(true);setPreflightResult(`Checking SO ${selected[0]} against McLeod...`);setPreflightDetails("");
  try{
   const form=new FormData();form.set("file",file);form.set("salesOrder",selected[0]);
   const response=await fetch("/api/cotton-import/preflight",{method:"POST",body:form});
   const data=await response.json();
   setPreflightDetails(JSON.stringify(data,null,2));
   setPreflightResult(response.ok
    ? data.duplicates?.length ? "Existing McLeod order(s): "+data.duplicates.map((x:{id:string})=>x.id).join(", ")
      : data.windows?.some((w:{status:string})=>w.status!=="ready") ? "Pickup windows need review: "+data.windows.map((w:{reason:string})=>w.reason).join("; ")
      : "McLeod duplicate check passed. No order created. Original RTL: "+data.windows.map((w:{originalRtlDate:string})=>w.originalRtlDate).join(", ")
    : "Preflight blocked: "+(data.error||"Unknown error"));
  }catch(e){setPreflightResult(e instanceof Error?e.message:"Preflight failed");}
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
   <p><strong>Review only.</strong> McLeod duplicate lookup is available for one selected order. Creation and delivery remain disabled.</p>
   <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
    <button type="button" onClick={()=>setSelected(result.reviews?.filter(r=>r.status!=="blocked").map(r=>r.salesOrder)||[])}>Select available</button>
    <button type="button" onClick={()=>setSelected([])}>Clear selection</button>
    <strong>{selected.length} selected</strong>
    <button type="button" disabled={busy||selected.length!==1} onClick={preflight}>Check selected order in McLeod</button>
    <button type="button" disabled title="Creation requires a verified McLeod write integration">Create selected orders (not yet enabled)</button>
   </div>

   {preflightResult&&<section role="status" aria-live="polite" style={{border:"2px solid #64748b",borderRadius:8,padding:16,margin:"16px 0",background:"rgba(100,116,139,.08)"}}>
    <strong>McLeod preflight result — {selected[0]||"last selected order"}</strong>
    <p style={{whiteSpace:"pre-wrap"}}>{preflightResult}</p>
    {preflightDetails&&<details><summary>Show server response</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{preflightDetails}</pre></details>}
   </section>}
   <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
    <thead><tr>{["Select","Sales order","BLNUM","Pickup locations","RTL / scheduled window","Late-fee policy","Status","Reason"].map(h=><th key={h} style={{padding:8,textAlign:"left",borderBottom:"1px solid gray"}}>{h}</th>)}</tr></thead>
    <tbody>{result.reviews?.map((r,i)=><tr key={i}><td><input type="checkbox" aria-label={`Select SO ${r.salesOrder}`} disabled={r.status==="blocked"} checked={selected.includes(r.salesOrder)} onChange={e=>setSelected(current=>e.target.checked?[...current,r.salesOrder]:current.filter(x=>x!==r.salesOrder))}/></td><td>{r.salesOrder}</td><td>{r.preview?.blnum||"—"}</td><td>{r.preview?.pickupStops.map(s=>s.locationCode).join(", ")||"—"}</td><td>{r.pickupWindows?.map((w,j)=><div key={j}>{w.locationCode}: {w.originalRtlDate} · {w.early||"?"}–{w.late||"?"} ({w.status})</div>)||"—"}</td><td>{r.pickupPolicies?.map((p,j)=><div key={j}>{p.locationCode}: {p.versions.length?p.versions.flatMap(v=>v.rules.filter(x=>x.rule_kind==="late_pickup").map(x=>`${x.fee_type} ${x.amount} / ${x.grace_days} grace days (${v.status})`)).join("; ")||"No late pickup rule":"No policy"}</div>)||"—"}</td><td>{r.status==="blocked"?"Blocked":r.pickupWindows?.every(w=>w.status==="ready")?"Hours ready — creation pending":"Hours need review"}</td><td>{r.reason}</td></tr>)}</tbody>
   </table></div>
  </section>}
 </main>;
}
