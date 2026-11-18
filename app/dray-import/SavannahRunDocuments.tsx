"use client";

import { useState, type CSSProperties } from "react";
import { runDrayBatch } from "@/lib/dray/batch-review";

type RunRow = { rowId: string; orderNumber: string; container: string; sendBol: boolean; olam: boolean };
type Interchange = { booking: string; inbound: string | null; outbound: string | null };
type Result = { row: RunRow; message: string; matches?: Interchange[] };

export default function SavannahRunDocuments({
  runId, rows, busy, writes, onBusy, button,
}: {
  runId: string;
  rows: RunRow[];
  busy: boolean;
  writes: boolean;
  onBusy: (busy: boolean) => void;
  button: CSSProperties;
}) {
  const [progress, setProgress] = useState("");
  const [bols, setBols] = useState<Result[]>([]);
  const [interchanges, setInterchanges] = useState<Result[]>([]);
  const bolRows = rows.filter(row => row.sendBol);

  const [uploads, setUploads] = useState<Result[]>([]);
  const matchedOlam = interchanges.flatMap(({row, matches}) =>
    row.olam && matches?.length === 1 && matches[0].inbound && matches[0].outbound
      ? [{...row, booking: matches[0].booking}] : [],
  );

  async function uploadInterchanges(targets: typeof matchedOlam) {
    if (!window.confirm(`Send ingate and outgate PDFs for ${targets.length} Olam order(s) to McLeod Imaging as 05-Interchange?`)) return;
    onBusy(true);
    setUploads([]);
    setProgress(`Sending interchanges · 0 of ${targets.length}`);
    let completed = 0;
    try {
      const failures = await runDrayBatch(targets, async row => {
        try {
          const response = await fetch("/api/dray-import/interchanges/imaging", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body:JSON.stringify({runId,rowId:row.rowId,booking:row.booking,confirmed:true}),
          });
          const data = await response.json();
          if (!response.ok || !data.ok) throw Error(data.error || "Interchange upload failed.");
          setUploads(previous => [...previous,{row,message:data.message}]);
          return undefined;
        } finally {
          completed++;
          setProgress(`Sending interchanges · ${completed} of ${targets.length}`);
        }
      });
      setUploads(previous => [...previous,...targets.filter(row => failures[row.rowId]).map(row => ({row,message:failures[row.rowId]}))]);
    } finally {
      onBusy(false);
    }
  }

  async function processRun(action: "send-savannah-bol" | "find-saved-interchanges") {
    const send = action === "send-savannah-bol";
    const targets = send ? bolRows : rows;
    const setResults = send ? setBols : setInterchanges;
    if (send && !window.confirm(`Send eligible BOLs for ${targets.length} Olam orders in this Savannah run to McLeod Imaging?`)) return;

    onBusy(true);
    setResults([]);
    let completed = 0;
    const results = new Map<string, Result>();
    const title = send ? "Sending BOLs" : "Finding interchanges";
    setProgress(`${title} · 0 of ${targets.length}`);
    try {
      const failures = await runDrayBatch(targets, async row => {
        try {
          const response = await fetch(send ? "/api/dray-import/bols/imaging" : "/api/dray-import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, runId, rowId: row.rowId, ...(send ? { confirmed: true } : {}) }),
          });
          const data = await response.json();
          if (!response.ok || !data.ok) throw Error(data.error || "Document request failed.");
          if (send) {
            results.set(row.rowId, {
              row,
              message: data.status === "already-indexed" ? "Already in McLeod Images" : data.message,
            });
          } else {
            const matches: Interchange[] = data.interchanges;
            results.set(row.rowId, {
              row, matches,
              message: matches.length > 1 ? "Multiple bookings match. Review SharePoint links." :
                matches.length ? "" : "No interchange PDFs found",
            });
          }
          return undefined;
        } finally {
          completed++;
          setProgress(`${title} · ${completed} of ${targets.length}`);
        }
      });
      setResults(targets.map(row => results.get(row.rowId) ?? { row, message: failures[row.rowId] }));
    } finally {
      onBusy(false);
    }
  }

  return (
    <section aria-label="Savannah run documents">
      <button style={button} disabled={busy || !writes || !bolRows.length} onClick={() => void processRun("send-savannah-bol")}>
        Send Olam BOLs to McLeod ({bolRows.length})
      </button>
      <button style={button} disabled={busy || !rows.length} onClick={() => void processRun("find-saved-interchanges")}>
        Find run interchanges ({rows.length})
      </button>
      {matchedOlam.length > 0 && (
        <button style={button} disabled={busy || !writes} onClick={() => void uploadInterchanges(matchedOlam)}>
          Send matched Olam interchanges to McLeod ({matchedOlam.length})
        </button>
      )}
      {uploads.length > 0 && (
        <details open>
          <summary>McLeod interchange upload results ({uploads.length})</summary>
          <ul>{uploads.map(({row,message}) => <li key={row.rowId}>{row.orderNumber} · {row.container} · {message}</li>)}</ul>
        </details>
      )}
      {progress && <p role="status">{progress}</p>}
      {bols.length > 0 && (
        <details open>
          <summary>BOL results ({bols.length})</summary>
          <ul>{bols.map(({ row, message }) => <li key={row.rowId}>{row.orderNumber} · {row.container} · {message}</li>)}</ul>
        </details>
      )}
      {interchanges.length > 0 && (
        <details open>
          <summary>SharePoint interchange results ({interchanges.length})</summary>
          <ul>{interchanges.map(({ row, matches, message }) => (
            <li key={row.rowId}>
              {row.orderNumber} · {row.container}{message && ` · ${message}`}
              {matchedOlam.some(match => match.rowId === row.rowId) && (
                <button style={button} disabled={busy || !writes} onClick={() => void uploadInterchanges(matchedOlam.filter(match => match.rowId === row.rowId))}>
                  Send this interchange pair
                </button>
              )}
              {matches?.map(match => {
                const query = new URLSearchParams({run: runId, row: row.rowId, booking: match.booking});
                const download = `/api/dray-import/interchanges/download?${query}`;
                return (
                  <div key={match.booking}>
                    {match.booking} · {match.inbound ? <a href={download + "&direction=in"} download>Ingate PDF</a> : "Ingate missing"}
                    {" · "}{match.outbound ? <a href={download + "&direction=out"} download>Outgate PDF</a> : "Outgate missing"}
                  </div>
                );
              })}
            </li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}
