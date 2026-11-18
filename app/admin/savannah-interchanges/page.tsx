"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InterchangeRun } from "@/lib/interchanges/run";

export default function SavannahInterchangesPage() {
  const [runs,setRuns] = useState<InterchangeRun[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [loaded,setLoaded] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/savannah-interchanges",{cache:"no-store"});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not load interchange runs.");
    setRuns(data.runs);
    setLoaded(true);
  }

  useEffect(()=>{void load().catch(reason=>setError(reason.message));},[]);

  async function runNow() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/savannah-interchanges",{method:"POST"});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not run the Outlook import.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Interchange run failed.");
    } finally {setBusy(false);}
  }

  return <main style={{maxWidth:1100,margin:"36px auto",padding:"0 24px"}}>
    <Link href="/dray-import">Savannah Dray Import</Link>
    <h1>Savannah Interchange Runs</h1>
    <p>Outlook folder <strong>SCMI Sav Truck Transactions</strong> · Daily at 12:00 UTC</p>
    <button disabled={busy} onClick={()=>void runNow()}>{busy ? "Processing the latest report…" : "Run latest Outlook report"}</button>
    {error && <p role="alert">{error}</p>}
    {loaded && !runs.length && <p>No runs recorded yet.</p>}
    {runs.map((run,index)=><details key={run.id} open={index === 0} style={{marginTop:18,padding:16,border:"1px solid #64748b",borderRadius:8}}>
      <summary>{new Date(run.startedAt).toLocaleString("en-US",{timeZone:"America/New_York",timeZoneName:"short"})} · {run.status} · {run.files.length} PDFs</summary>
      <p>{run.source}{run.receivedAt && ` · Received ${new Date(run.receivedAt).toLocaleString("en-US",{timeZone:"America/New_York",timeZoneName:"short"})}`}</p>
      {run.error && <p role="alert">{run.error}</p>}
      <ul>{run.files.map(file=><li key={file.path}>
        {file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.path}</a> : file.path} · {file.status}{file.error && ` · ${file.error}`}
      </li>)}</ul>
    </details>)}
  </main>;
}
