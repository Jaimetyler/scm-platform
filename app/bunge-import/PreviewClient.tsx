"use client";
import { MAX_COTTON_PICKUPS } from "@/lib/cotton-import/stop-off";
import {useRef,useState} from "react";
import HoustonPreviewClient, { type HoustonResult } from "./HoustonPreviewClient";
import BatchCreate from "./BatchCreate";
import type {Proposal} from "@/lib/bunge/preview";
import styles from "../cotton-locations/outreach/outreach.module.css";
import { defaultDeliveryDate, OLAM_CUSTOMER, type DeliveryLocation, type InboundTerminal } from "@/lib/bunge/destinations";
import DispatchUpload, { equipmentLabels, type DispatchInput } from "./DispatchUpload";
type Result={customerId:string;equipment?:string;delivery?:Omit<DeliveryLocation,"receivingHours">&Partial<Pick<DeliveryLocation,"receivingHours">>;excluded?:{sheet:string;row:number;reason:string}[];filename:string;sourceRows:number;sourceDestinations:string[];revenue:string;proposals:Proposal[]};
import {pickupMonthRanges} from "@/lib/bunge/duplicate-window";
type Check={busy?:boolean;error?:string;matches?:{id:string;blnum:string;revenue:string;status?:string;statusLabel?:string;pickupDates?:string[]}[]};
export default function PreviewClient({terminal}:{terminal:InboundTerminal}){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[query,setQuery]=useState(""),[selected,setSelected]=useState<Proposal|null>(null),[checks,setChecks]=useState<Record<string,Check>>({});
 const [submission,setSubmission]=useState<DispatchInput|null>(null);
 const [houstonResult,setHoustonResult]=useState<HoustonResult|null>(null);
 const [olamPreflight,setOlamPreflight]=useState<string[]>([]);
 const generation=useRef(0);
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement|null>(null);
 function clear(){generation.current++;setError("");setResult(null);setHoustonResult(null);setSubmission(null);setChecks({});setQuery("");}
 async function preview(input:DispatchInput){if(busy)return;
 clear();
 setBusy(true);try{
 const data=new FormData();data.set("file",input.file);data.set("terminal",terminal);data.set("destination",input.destination);data.set("equipment",input.equipment);
 const response=await fetch("/api/bunge-import",{method:"POST",body:data});
 const dataResult=await response.json();
 if(!response.ok||!dataResult.ok)throw Error(dataResult.error||"Preview failed");
 if(dataResult.useHoustonBungePreview){
  const legacyResponse=await fetch("/api/cotton-import/upload",{method:"POST",body:data});
  const legacyResult=await legacyResponse.json();
  if(!legacyResponse.ok||!legacyResult.ok)throw Error(legacyResult.error||"Preview failed");
  setHoustonResult(legacyResult);
 }else setResult(dataResult);
 setSubmission(input);
 }catch(e){setError(e instanceof Error?e.message:"Preview failed")}finally{setBusy(false)}}
 async function duplicates(p:Proposal){const revision=generation.current;setChecks(v=>({...v,[p.key]:{busy:true}}));try{const r=await fetch("/api/bunge-import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"duplicates",customerId:p.customerId,blnum:p.blnum,pickupDates:p.pickups.map(s=>s.rtl)})});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||"Lookup failed");if(revision===generation.current)setChecks(v=>({...v,[p.key]:{matches:j.matches}}))}catch(e){if(revision===generation.current)setChecks(v=>({...v,[p.key]:{error:e instanceof Error?e.message:"Lookup failed"}}))}}
 async function preflightOlam(order: Proposal) {
  if (!submission || !order.destination || busy) return;
  setBusy(true);
  setOlamPreflight(["Checking order…"]);
  try {
   const form=new FormData();
   form.set("action","preflight-olam");
   form.set("file",submission.file);
   form.set("terminal",terminal);
   form.set("destination",order.destination);
   form.set("equipment",submission.equipment);
   form.set("salesOrder",order.so);
   const response=await fetch("/api/cotton-import/preflight",{method:"POST",body:form});
   const data=await response.json();
   if(!response.ok||!data.ok)throw Error(data.error||"Preflight failed.");
   setChecks(previous=>({...previous,[order.key]:{matches:data.duplicates}}));
   setOlamPreflight([data.canCreate ? "Ready to create in McLeod." : data.reason || "Order requires review."]);
  }catch(cause){
   setOlamPreflight([cause instanceof Error ? cause.message : "Preflight failed."]);
  }finally{
   setBusy(false);
  }
 }
 async function checkOlamOrders(proposals: Proposal[]) {
  const revision=generation.current;
  setBusy(true);
  try {
   for(const proposal of proposals) {
    if(revision!==generation.current) break;
    if(proposal.pickups.length<=2&&proposal.pickups.every(stop=>stop.rtl)) await duplicates(proposal);
   }
  } finally {
   setBusy(false);
  }
 }
 const issueCount=(p:Proposal)=>p.issues.length+p.pickups.reduce((n,s)=>n+s.issues.length,0);
 const filtered=result?.proposals.filter(p=>[p.mark,p.so,p.blnum,...p.pickups.map(s=>s.location?.mcleod_code||s.warehouse)].some(v=>v.toLowerCase().includes(query.toLowerCase().trim())))||[];
 function close(){dialog.current?.close();setSelected(null);opener.current?.focus()}
 const checkLabel=(p:Proposal)=>{const c=checks[p.key];return c?.busy?"Checking…":c?.error?"Lookup incomplete":c?.matches?c.matches.length?`${c.matches.length} non-void match(es)`:"No non-void BLNUM match in pickup date range":"Not checked"};
 return <section aria-label="Cotton dispatch preview">
 <DispatchUpload terminal={terminal} busy={busy} onPreview={preview} onChange={clear} />
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 {houstonResult&&submission&&<HoustonPreviewClient result={houstonResult} submission={submission} onBusy={setBusy} />}
 {result&&<><div className={styles.stats}><span><b>{result.sourceRows}</b> Pickup rows</span><span><b>{result.proposals.length}</b> Proposed orders</span><span><b>{result.proposals.filter(p=>p.pickups.length===2).length}</b> Two-pickup orders</span><span><b>{result.proposals.filter(p=>p.pickups.some(s=>!s.location)).length}</b> Need location mapping</span></div>
 <p>{result.filename} · {result.customerId} · Revenue: {result.revenue}</p>{!!result.excluded?.length&&<details className={styles.guide}><summary>{result.excluded.length} pickup row(s) excluded from other or unknown carrier sections</summary>{result.excluded.map((r,i)=><p key={i}>{r.sheet}:{r.row} · {r.reason}</p>)}</details>}<p>Report destination: {result.sourceDestinations.join("; ")||"Not found"}. Selected delivery: {result.delivery?.code||"Needs review"}; confirm any difference before creating orders.</p>
 {result.customerId===OLAM_CUSTOMER&&submission&&<div>
  <p>Review the destination, then create eligible OLAM orders in McLeod.</p>
  <button type="button" disabled={busy} onClick={()=>void checkOlamOrders(result.proposals)}>Check all OLAM orders in McLeod</button>
 </div>}
 {submission&&<BatchCreate key={`${result.customerId}:${result.delivery?.code ?? ""}`} terminal={terminal} submission={submission} destination={result.delivery?.code} customerId={result.customerId} disabled={busy} orders={result.proposals.map(proposal=>proposal.so)} onBusy={setBusy} />}
 <div className={styles.toolbar}><input aria-label="Search proposed orders" placeholder="Search SO, mark or warehouse" value={query} onChange={e=>setQuery(e.target.value)}/></div>
 <div className={styles.tableWrap}><table><thead><tr><th>SO / Mark</th><th>BLNUM</th><th>Bales</th><th>Pickups</th><th>Equipment</th><th>Review</th><th>Existing orders</th><th/></tr></thead><tbody>{filtered.map(p=><tr key={p.key}><td><strong>{p.so}</strong><small>{p.mark}</small></td><td>{p.blnum}</td><td>{p.bales}</td><td>{p.pickups.map((s,i)=><small key={i}>{s.location?.mcleod_code||s.warehouseCode||"Unmapped"} · {s.bales} bales · {s.rtl||"No RTL date"}</small>)}</td><td>{equipmentLabels[p.equipment as keyof typeof equipmentLabels] ?? "Needs review"}</td><td>{issueCount(p)?`${issueCount(p)} review note(s)`:"Review source details"}</td><td>{checkLabel(p)}{checks[p.key]?.matches?.map(match=><small key={match.id}>Order {match.id}</small>)}</td><td><button disabled={busy} onClick={e=>{opener.current=e.currentTarget;setOlamPreflight([]);setSelected(p);dialog.current?.showModal()}}>View preview</button></td></tr>)}</tbody></table></div></>}
 <dialog className={styles.dialog} aria-labelledby="bunge-preview-title" ref={dialog} onCancel={e=>{e.preventDefault();close()}}>{selected&&<><header className={styles.dialogHeader}><div><small>SO {selected.so} · {selected.customerId} · {selected.revenue} · {equipmentLabels[selected.equipment as keyof typeof equipmentLabels] ?? "Equipment needs review"}</small><h2 id="bunge-preview-title">{selected.blnum}</h2></div><button aria-label="Close order preview" onClick={close}>×</button></header><div className={styles.body}>
 {selected.issues.map((s,i)=><p key={i} className={styles.error}>{s}</p>)}
 {selected.pickups.map((s,i)=><section className={styles.documents} key={i}><h3>Pickup {i+1} · {s.bales} bales</h3><p>{s.warehouse} · Source code: {s.warehouseCode||"Missing"}</p><p>Mapped: <b>{s.location?.mcleod_code||"Unresolved"}</b> · {s.location?.name||"Review warehouse mapping"}</p><p>Source address: {s.address.join(", ")||"Not repeated on these source rows"}</p><p>Location address: {[s.location?.address,s.location?.city,s.location?.state].filter(Boolean).join(", ")||"Unknown"}</p><p>Source RTL: <b>{s.rtl||"Missing"}</b> · Source rows: {s.sourceRows.join(", ")}</p><p>Suggested pickup window: {s.hours?.open_time?.slice(0,5)||"Unknown"} – {s.hours?.close_time?.slice(0,5)||"Unknown"} local</p><p>Check-in cutoff: {s.hours?.checkin_cutoff||"Unknown"} · Appointment: {s.hours?.appointment_required===true?"Required":s.hours?.appointment_required===false?"Not required":"Unknown"}</p><small>{s.hours?.verified?"Source-confirmed schedule":"Unverified / missing schedule"} · {s.hours?.source_reference||"No schedule source"}</small>{s.issues.map((m,j)=><p key={j} className={styles.helper}>{m}</p>)}</section>)}
 <section className={styles.documents}><h3>Delivery</h3><p>{selected.destination||"Needs review"} · {selected.bales} bales</p>{result?.delivery&&<p><strong>{result.delivery.name}</strong><br/>{[result.delivery.address,result.delivery.address2,result.delivery.city,result.delivery.state,result.delivery.zip].filter(Boolean).join(", ")}</p>}{result?.delivery?.receivingHours&&<p>Proposed delivery · {defaultDeliveryDate(selected.pickups.map(stop=>stop.rtl)) || "Date needs review"} · {result.delivery.receivingHours.open}–{result.delivery.receivingHours.close} local · {result.delivery.receivingHours.method}</p>}<p className={styles.helper}>Creation checks delivery dates, schedules, equipment and duplicates before submitting each order. No charge amounts are inferred from repeated freight/fuel detail rows.</p></section>
 <section className={styles.documents}><h3>Duplicate check — all statuses except void</h3><p>Pickup date range: {selected.pickups.length<=MAX_COTTON_PICKUPS&&selected.pickups.every(s=>s.rtl)?pickupMonthRanges(selected.pickups.map(s=>s.rtl)).map(r=>r.from+" through "+r.to).join("; "):"Pickup dates require manual review"}</p><p>{checkLabel(selected)}</p>{checks[selected.key]?.error&&<p role="alert" className={styles.error}>{checks[selected.key].error}</p>}{checks[selected.key]?.matches?.map(m=><p key={m.id}>{m.id} · {m.blnum} · {m.revenue} · Status: {m.statusLabel||m.status} · Pickup: {m.pickupDates?.join(", ")}</p>)}<button disabled={busy||checks[selected.key]?.busy||selected.pickups.length>MAX_COTTON_PICKUPS||selected.pickups.some(s=>!s.rtl)} onClick={()=>void duplicates(selected)}>Check BLNUM in McLeod</button><p className={styles.helper}>Read-only check for {selected.customerId} orders in every status except void with this mark and bale count (BALES and B/C are equivalent) and scheduled pickup from one calendar month before through one month after the proposed pickup date (inclusive). All scheduled pickup dates are covered. A different bale count or reference may not match; this check does not approve creation.</p></section>
 {selected.customerId===OLAM_CUSTOMER&&<section className={styles.documents}>
  <h3>Single-order preflight</h3>
  <button type="button" disabled={busy||!selected.destination} onClick={()=>void preflightOlam(selected)}>Check creation eligibility</button>
  <div aria-live="polite">{olamPreflight.map(message=><p key={message}>{message}</p>)}</div>
 </section>}
 </div><footer><button onClick={close}>Close</button></footer></>}</dialog>
 </section>;
}
