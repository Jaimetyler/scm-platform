"use client";
import { useState } from "react";

type Review = { salesOrder:string;status:string;reason:string;preview?:{blnum:string;pickupStops:{locationCode:string;scheduledDate:string}[]} };
type Result = { ok:boolean;error?:string;filename?:string;destination?:string;counts?:{orders:number;pickupLines:number;blocked:number;sourceErrors:number};reviews?:Review[];sourceErrors?:{row:number;reason:string}[] };
export default function CottonImportPage() {
 const [file,setFile]=useState<File|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false);
 async function preview() {
  if(!file)return;
  setBusy(true);setResult(null);
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
  <p>Bunge (BUNGOMNE) dispatch preview. This screen cannot create or change McLeod orders.</p>
  <label>Dispatch Excel workbook <input type="file" accept=".xls,.xlsx" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
  <button type="button" disabled={!file||busy} onClick={preview} style={{marginLeft:16,padding:10}}>{busy?"Checking...":"Preview dispatch"}</button>
  {result&&!result.ok&&<p role="alert" style={{color:"crimson"}}>{result.error}</p>}
  {result?.ok&&<section>
   <h2>{result.destination}</h2>
   <p>{result.counts?.orders} grouped orders · {result.counts?.pickupLines} pickup lines · {result.counts?.blocked} blocked · {result.counts?.sourceErrors} source errors</p>
   <p><strong>Review only.</strong> No creation, duplicate lookup, or delivery is enabled.</p>

   <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
    <thead><tr>{["Sales order","BLNUM","Pickup locations","Status","Reason"].map(h=><th key={h} style={{padding:8,textAlign:"left",borderBottom:"1px solid gray"}}>{h}</th>)}</tr></thead>
    <tbody>{result.reviews?.map((r,i)=><tr key={i}><td>{r.salesOrder}</td><td>{r.preview?.blnum||"—"}</td><td>{r.preview?.pickupStops.map(s=>s.locationCode).join(", ")||"—"}</td><td>{r.status}</td><td>{r.reason}</td></tr>)}</tbody>
   </table></div>
  </section>}
 </main>;
}
