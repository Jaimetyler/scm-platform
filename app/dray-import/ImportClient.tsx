"use client";
import { useEffect, useRef, useState } from "react";
import styles from "../ecotton-import/review.module.css";
import BolImaging from "./BolImaging";
import SavannahRunDocuments from "./SavannahRunDocuments";
import {bolEligible} from "@/lib/dray-bols/eligible";
import { canReviewDrayPay, type interchangeContainerMatches } from "@/lib/dray/review";
import { runDrayBatch } from "@/lib/dray/batch-review";
import type { Profile } from "@/lib/ecotton/model";
const card: React.CSSProperties = {
  padding: 22,
  border: "1px solid #334155",
  borderRadius: 14,
  background: "#111c30",
  marginBottom: 18,
};
const field: React.CSSProperties = {
  display: "block",
  padding: 10,
  marginTop: 8,
  marginBottom: 16,
  width: "100%",
  maxWidth: 650,
  background: "#0f172a",
  color: "white",
  border: "1px solid #64748b",
  borderRadius: 6,
};
const button: React.CSSProperties = {
  padding: "11px 18px",
  borderRadius: 8,
  border: "1px solid #64748b",
  background: "#155e75",
  color: "white",
  cursor: "pointer",
  marginRight: 10,
  marginTop: 10,
};
function deliveryNote(o: any) {
  try { const n = JSON.parse(o.note); return n.error || (o.status === "delivered" ? "Delivery and ready-to-bill read-back verified." : "Delivery in progress; do not retry."); }
  catch { return o.note; }
}
function displayDeliveryDate(value: string) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]} ${m[4]}:${m[5]}:${m[6]} (${m[7]}:${m[8]})` : value;
}
export default function ImportClient() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [batchFailures, setBatchFailures] = useState<Record<string, string>>({});
  const [batchSummary, setBatchSummary] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const containerField = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (openedId && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!openedId && dialog.current?.open) dialog.current.close();
  }, [openedId]);
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [profileId, setProfile] = useState("DRAY-SAV-SAVWHSE");
  const [summary, setSummary] = useState(""),
    [detail, setDetail] = useState(""),
    [names, setNames] = useState({ summary: "", detail: "" });
  const [runs, setRuns] = useState<any[]>([]),
    [saved, setSaved] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [writes, setWrites] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [review, setReview] = useState({ booking: "", container: "", carrierPay: "" });
  const drafts = useRef(new Map<string, typeof review>());
  const [interchanges, setInterchanges] = useState<{ booking: string; inbound: string | null; outbound: string | null }[] | null>(null);
  const [suggestions, setSuggestions] = useState<ReturnType<typeof interchangeContainerMatches> | null>(null);
  const [deliveryPreview, setDeliveryPreview] = useState<any[]>([]);
  useEffect(() => { setDeliveryPreview([]); setOpenedId(null); setQuery(""); setFilter("all"); setQueueOpen(false); setBatchFailures({}); setBatchSummary(""); drafts.current.clear(); }, [saved?.run.id]);
  async function call(body?: any, runId?: string) {
    const res = await fetch(
      "/api/dray-import" +
        (runId ? "?run=" + encodeURIComponent(runId) : ""),
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok || !data.ok)
      throw new Error(data.error || "Import request failed.");
    return data;
  }
  async function refresh(runId?: string) {
    const data = await call(undefined, runId);
    if (runId) {
      setSaved(data);
      if (data.run?.profile?.id) setProfile(data.run.profile.id);
      setDeliveryPreview([]);
    }
    else {
      setProfiles(data.profiles);
      setRuns(data.runs);
    }
    if (data.writesEnabled !== undefined) setWrites(data.writesEnabled);
    return data;
  }
  useEffect(() => {
    refresh()
      .then(() => {
        const runId = new URLSearchParams(window.location.search).get("run");
        if (runId) return refresh(runId);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const items = saved?.items || [],
    total = items.reduce(
      (sum, item) => sum + Number(item.order.invoice.cents),
      0,
    ),
    ready = items.filter(
      (item) =>
        !item.conflict && ["ready", "created"].includes(item.order.status),
    );
  const chosen = ready.filter((item) => selected.has(item.order_id));
  const deliverable = items.filter((item) => !item.conflict && item.order.status === "verified" && item.order.profile.id === profileId);
  const chosenDelivery = deliverable.filter((item) => selected.has(item.order_id));
  const bolOrders=items.filter(bolEligible),chosenBols=bolOrders.filter(item=>selected.has(item.order_id));
  async function downloadBols(ids:string[],format:"pdf"|"zip"){await act(async()=>{
    let res:Response;
    if(format==="pdf")res=await fetch("/api/dray-import/bols?run="+encodeURIComponent(saved.run.id)+"&row="+encodeURIComponent(ids[0]),{cache:"no-store"});
    if(!res||res.status===404)res=await fetch("/api/dray-import/bols",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({runId:saved.run.id,rowIds:ids,format})});
    if(!res.ok){const j=await res.json();throw Error(j.error||"BOL generation failed");}
    const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]||"Savannah_BOLs.zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });}

  const category = (item: any, failures = batchFailures) => item.conflict ||
    (item.order.status !== "delivered" && failures[item.order_id]) ? "attention" :
    ["ready", "created"].includes(item.order.status) ? "ready" :
    ["verified", "delivered"].includes(item.order.status) ? "imported" : "attention";
  const visible = items.filter((item: any) => {
    const i = item.order.invoice;
    return (filter === "all" || category(item) === filter) &&
      [i.reference, i.mark, i.customerName, i.customerId, item.order.order_id, item.order.status]
        .some(value => String(value || "").toLowerCase().includes(query.trim().toLowerCase()));
  });
  const opened = items.find((item: any) => item.order_id === openedId);
  const canCorrect = opened && !opened.conflict && opened.order.status === "preview_blocked" &&
    !opened.order.order_id && canReviewDrayPay(opened.order.invoice);
  const queue = items.filter(item => category(item) === "attention");
  const queueIndex = queue.findIndex(item => item.order_id === openedId);

  function openRow(item: any, inQueue: boolean, keepDraft = true) {
    if (openedId && keepDraft) drafts.current.set(openedId, review);
    const invoice = item.order.invoice;
    setReview(drafts.current.get(item.order_id) ?? {
      booking:invoice.booking || "", container:invoice.container || "",
      carrierPay:invoice.carrierCents == null ? "" : (invoice.carrierCents/100).toFixed(2),
    });
    setSuggestions(null);
    setInterchanges(null);
    setError("");
    setQueueOpen(inQueue);
    setOpenedId(item.order_id);
  }

  function updateReviewedRow(data: any) {
    setSaved(data);
    const current = data.items.find(item => item.order_id === openedId);
    if (!current || current.conflict || !["ready", "verified", "delivered"].includes(current.order.status)) return;
    const remainingFailures = {...batchFailures};
    delete remainingFailures[current.order_id];
    setBatchFailures(remainingFailures);
    drafts.current.delete(current.order_id);
    if (!queueOpen) return;
    const remaining = data.items.filter(item => category(item, remainingFailures) === "attention");
    const next = remaining[Math.min(queueIndex, remaining.length-1)];
    if (next) openRow(next, true, false);
    else setOpenedId(null);
  }

  async function finishBatch(rows: {rowId:string; planHash?:string}[], action: "execute-and-deliver" | "deliver") {
    let latest = saved;
    const failures = await runDrayBatch(rows, async ({rowId, planHash}) => {
      const data = await call({action, runId:saved.run.id, rowId, confirmed:true, planHash});
      latest = data;
      setSaved(data);
      const order = data.items.find(item => item.order_id === rowId)?.order;
      if (order?.status === "delivered") return;
      if (order?.status === "verified") return "The order rated successfully. Review the delivery details.";
      return order ? deliveryNote(order) || "Review this order before processing again." : "The order was missing from the response.";
    });
    let refreshError = "";
    try { latest = await refresh(saved.run.id); }
    catch (reason) { refreshError = ` Refresh failed: ${(reason as Error).message}`; }
    const combined = {...batchFailures, ...failures};
    const reviewItems = latest.items.filter(item => category(item, combined) === "attention");
    const attempted = new Set(rows.map(item => item.rowId));
    const delivered = latest.items.filter(item => attempted.has(item.order_id) && item.order.status === "delivered").length;
    setBatchFailures(combined);
    setConfirmed(false);
    setBatchSummary(`${delivered} of ${rows.length} selected orders delivered.${refreshError}`);
    if (reviewItems.length) {
      opener.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
      openRow(reviewItems[0], true, false);
    }
  }
  async function previewDelivery() {
    setDeliveryPreview([]);
    await act(async () => {
      const previews: any[] = [];
      for (const item of chosenDelivery) {
        const data = await call({ action: "delivery-preview", runId: saved.run.id, rowId: item.order_id });
        previews.push({ ...data, rowId: item.order_id, reference: item.order.invoice.reference });
      }
      setDeliveryPreview(previews);
    });
  }
  async function deliver() {
    if (!writes || !deliveryPreview.length) return;
    if (!window.confirm(`Deliver ${deliveryPreview.length} reviewed orders and mark ready to bill? Scheduled earliest/latest dates will become actual arrival/departure. Movement status will be Delivered and brokerage status FINISHED.`)) return;
    await act(async () => {
      setDeliveryPreview([]);
      await finishBatch(deliveryPreview, "deliver");
    });
  }
  async function execute() {
    if (!confirmed || !chosen.length || !writes) return;
    if (
      !window.confirm(
        `Create, rate, and deliver ${chosen.length} selected orders? Verified orders will be marked Ready to Bill using their scheduled times.`,
      )
    )
      return;
    await act(() => finishBatch(chosen.map(item => ({rowId:item.order_id})), "execute-and-deliver"));
  }
  return (
    <main className={styles.page}
      style={{
        maxWidth: 1300,
        margin: "0 auto",
        padding: 24,
        color: "#e2e8f0",
      }}
    >
      <h1>Savannah Dray Import</h1>
      <p>
        Upload the dray report and FirstStar listing, review billing and carrier pay, then create and deliver selected orders.
      </p>
      {!writes && (
        <p role="status" style={{ ...card, borderColor: "#eab308" }}>
          Preview and read-only reconciliation are available. Order creation and
          rating are disabled in this environment.
        </p>
      )}
      {error && (
        <div
          role="alert"
          style={{ ...card, borderColor: "#ef4444", whiteSpace: "pre-wrap" }}
        >
          {error}
        </div>
      )}
      <section style={card}>
        <h2>Weekly reports</h2>
        <p><a href="/ecotton-import">eCotton import</a></p>
        <div className={styles.uploadGrid}>
        <div>
        <label htmlFor="import-profile">Terminal / warehouse</label>
        <select
          id="import-profile"
          style={field}
          value={profileId}
          disabled={busy}
          onChange={(e) => {
            setProfile(e.target.value);
            setSaved(null);
            setConfirmed(false);
            setSelected(new Set());
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.confirmed ? "" : " — creation defaults not confirmed"}
            </option>
          ))}
        </select>
        </div>

        <div>
        <label htmlFor="import-summary">Dray report (new format CSV)</label>
        <input
          id="import-summary"
          type="file"
          accept=".csv,text/csv"
          style={field}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setSaved(null);
            setConfirmed(false);
            setSelected(new Set());
            setSummary("");
            if (file) {
              if (file.size > 2000000) {
                setError("Summary exceeds 2 MB.");
                return;
              }
              file.text().then((text) => {
                setSummary(text);
                setNames((n) => ({ ...n, summary: file.name }));
              });
            }
          }}
        />
        </div>
        <div>
        <label htmlFor="import-detail">FirstStar load listing (Excel)</label>
        <input
          id="import-detail"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={field}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setSaved(null);
            setConfirmed(false);
            setSelected(new Set());
            setDetail("");
            if (file) {
              if (file.size > 8000000) {
                setError("FirstStar listing exceeds 8 MB.");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                setDetail(String(reader.result).split(",")[1] || "");
                setNames(n => ({...n, detail:file.name}));
              };
              reader.onerror = () => setError("Unable to read FirstStar listing");
              reader.readAsDataURL(file);
            }
          }}
        />
        </div>
        </div>
        {profiles.find((p) => p.id === profileId) && (
          <p>
            Warehouse: SAVWHSE · GPA → SAVPORT · Ocean Terminal → SAVOT.
            NOBILL and rows without a port or steamship line are skipped.
          </p>
        )}
        <button
          style={button}
          disabled={
            busy ||
            !summary ||
            !detail ||
            !profiles.find((p) => p.id === profileId)?.confirmed
          }
          onClick={() =>
            act(async () => {
              const data = await call({
                action: "preview",
                profileId,
                drayCSV: summary,
                firstStarBase64: detail,
              });
              setSaved(data);
              setWrites(data.writesEnabled);
              setConfirmed(false);
              setSelected(new Set());
              await refresh();
            })
          }
        >
          {busy ? "Working…" : "Check reports and duplicates"}
        </button>
        {names.summary && names.detail && (
          <p>
            {names.summary} + {names.detail}
          </p>
        )}
      </section>
      {saved && (
        <section style={card}>
          <h2>Import review</h2>
          <p>
            {items.length} orders · Expected total ${(total / 100).toFixed(2)} ·{" "}
            {ready.length} eligible to process · {chosen.length} selected · {saved.run.profile.reportSummary?.skipped || 0} skipped
          </p>
          <p>
            Customer rates include chassis. Carrier pay comes from the matched FirstStar total. A repeated upload reopens its saved review.
          </p>
          <p>Carrier pay: ${ (items.reduce((n,x)=>n+(x.order.invoice.carrierCents||0),0)/100).toFixed(2)} · Gross margin: {items.some(x=>x.order.invoice.carrierCents == null) ? "Awaiting carrier matches" : `$${((total-items.reduce((n,x)=>n+x.order.invoice.carrierCents,0))/100).toFixed(2)}`}</p>
          <button
            style={button}
            disabled={busy || !writes}
            onClick={() => {
              setSelected(new Set(ready.map((item) => item.order_id)));
              setDeliveryPreview([]);
            }}
          >
            Select eligible orders
          </button>
          <button style={button} disabled={busy || !writes || !deliverable.length}
            onClick={() => { setSelected(new Set(deliverable.map((item) => item.order_id))); setDeliveryPreview([]); }}>
            Select verified orders ({deliverable.length})
          </button>
          <button style={button} disabled={busy||!bolOrders.length} onClick={()=>{setSelected(new Set(bolOrders.map(item=>item.order_id)));setDeliveryPreview([]);}}>Select BOL orders ({bolOrders.length})</button>
          <button style={button} disabled={busy||!chosenBols.length||chosenBols.length>100} onClick={()=>void downloadBols(chosenBols.map(item=>item.order_id),"zip")}>Generate BOLs ({chosenBols.length})</button>
          {saved.run.profile.id === "DRAY-SAV-SAVWHSE" && (
            <SavannahRunDocuments
              key={saved.run.id} runId={saved.run.id} button={button}
              busy={busy} writes={writes} onBusy={setBusy}
              rows={items.filter(item => !item.conflict && item.source_hash === item.order.source_hash &&
                item.order.profile.id === "DRAY-SAV-SAVWHSE" && item.order.order_id &&
                ["verified", "delivered"].includes(item.order.status)).map(item => ({
                  rowId: item.order_id,
                  orderNumber: item.order.order_id,
                  container: item.order.invoice.container,
                  sendBol: item.order.invoice.customerId === "OLAMRITX" && bolEligible(item),
                }))}
            />
          )}
          <button
            style={button}
            disabled={busy}
            onClick={() => { setSelected(new Set()); setDeliveryPreview([]); }}
          >
            Clear selection
          </button>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !writes}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I reviewed customers, warehouse, references, dates and per-order
            invoice totals.
          </label>
          <br />
          <button
            style={button}
            disabled={busy || !writes || !confirmed || !chosen.length}
            onClick={execute}
          >
            Create, deliver and mark ready to bill ({chosen.length})
          </button>
          <button
            style={button}
            disabled={busy}
            onClick={() =>
              act(async () => {
                await refresh(saved.run.id);
              })
            }
          >
            Refresh results
          </button>
          <button style={button} disabled={busy || !writes || !chosenDelivery.length} onClick={previewDelivery}>
            Preview delivery ({chosenDelivery.length})
          </button>
          {!!deliveryPreview.length && <section style={{ ...card, marginTop: 20 }}>
            <h3>Review delivery — {deliveryPreview.length} orders</h3>
            <p>Copy scheduled earliest/latest into actual arrival/departure. Set movement to Delivered, brokerage to FINISHED, and ready to bill to Yes.</p>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}>
              <thead><tr>{["Reference / order", "Movement", "Stop", "Actual arrival", "Actual departure"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{deliveryPreview.flatMap((p) => p.plan.stops.map((s) => <tr key={p.rowId + s.id}>
                <td>{p.reference} / {p.plan.orderId}</td><td>{p.plan.movementId}</td><td>{s.type}</td><td>{displayDeliveryDate(s.arrival)}</td><td>{displayDeliveryDate(s.departure)}</td>
              </tr>))}</tbody>
            </table></div>
            <button style={button} disabled={busy || !writes} onClick={deliver}>Deliver reviewed orders ({deliveryPreview.length})</button>
            <button style={button} disabled={busy} onClick={() => setDeliveryPreview([])}>Cancel delivery preview</button>
          </section>}
          {batchSummary && <p role="status">{batchSummary}</p>}
          {queue.length > 0 && <button style={button} disabled={busy} onClick={event => {
            opener.current = event.currentTarget; openRow(queue[0], true);
          }}>Review exceptions ({queue.length})</button>}
          <div className={styles.toolbar}>
            <input aria-label="Search import orders" placeholder="Search customer, reference, mark or SCM order number" value={query} onChange={e => setQuery(e.target.value)} />
            <select aria-label="Filter import status" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">All orders ({items.length})</option>
              <option value="ready">Ready to process ({items.filter(x => category(x) === "ready").length})</option>
              <option value="attention">Needs attention ({items.filter(x => category(x) === "attention").length})</option>
              <option value="imported">Already imported ({items.filter(x => category(x) === "imported").length})</option>
            </select>
            <span>{visible.length} shown · {selected.size} selected across all filters</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead>
                <tr>
                  {[
                    "Mark / container",
                    "Customer",
                    "Invoice date",
                    "Billing / carrier pay",
                    "State / SCM order number",
                    "Review",
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{ padding: 10, borderBottom: "1px solid #64748b" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!visible.length && <tr><td colSpan={6}>No orders match this search and status.</td></tr>}
                {visible.map((item) => {
                  const o = item.order,
                    i = o.invoice;
                  return (
                    <tr key={item.id}>
                      <td style={{ padding: 10 }}>
                        {!item.conflict &&
                          (["ready", "created"].includes(o.status) || (o.status === "verified" && o.profile.id === profileId) || bolEligible(item)) && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${i.reference}`}
                              checked={selected.has(item.order_id)}
                              disabled={busy || (!writes && !bolEligible(item))}
                              onChange={(e) => {
                                setDeliveryPreview([]);
                                setSelected((previous) => {
                                  const next = new Set(previous);
                                  if (e.target.checked) next.add(item.order_id);
                                  else next.delete(item.order_id);
                                  return next;
                                });
                              }}
                            />
                          )}
                        {i.reference}
                        <br />
                        {i.mark}
                      </td>
                      <td>
                        {i.customerName}
                        <br />
                        {i.customerId}
                      </td>
                      <td>{i.invoiceDate}</td>
                      <td>
                        ${(i.cents / 100).toFixed(2)}
                        <br />
                        Pay: {i.carrierCents == null ? "Missing" : `$${(i.carrierCents / 100).toFixed(2)}`}
                      </td>
                      <td>
                        {item.conflict ? "Source conflict" : o.status.replaceAll("_", " ")}
                        <br />
                        {o.order_id || "Not created"}
                      </td>
                      <td><button style={button} disabled={busy} onClick={event => {
                        opener.current = event.currentTarget;
                        openRow(item, false);
                      }}>View details</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="import-detail-title"
        onCancel={event => { if (busy) event.preventDefault(); }}
        onClose={() => {
          if (openedId) drafts.current.set(openedId, review);
          setOpenedId(null); setQueueOpen(false); setError(""); opener.current?.focus();
        }}>
        {opened && <>
          <header className={styles.modalHeader}>
            <div><span className={styles.eyebrow}>IMPORT ORDER</span><h2 id="import-detail-title">{opened.order.invoice.customerName}</h2><p>{opened.order.invoice.reference} · {opened.order.invoice.mark}</p></div>
            <button aria-label="Close order details" disabled={busy} onClick={() => dialog.current?.close()}>×</button>
          </header>
          <div className={styles.modalBody}>
            {queueOpen && <nav aria-label="Review exceptions">
              <button style={button} disabled={busy || queueIndex <= 0} onClick={() => openRow(queue[queueIndex-1], true)}>Previous</button>
              <span aria-live="polite">Exception {queueIndex+1} of {queue.length}</span>
              <button style={button} disabled={busy || queueIndex < 0 || queueIndex+1 >= queue.length}
                onClick={() => openRow(queue[queueIndex+1], true)}>Next</button>
            </nav>}
            {error && !canCorrect && <p role="alert" className={styles.error}>{error}</p>}
            {batchFailures[opened.order_id] && <p>{batchFailures[opened.order_id]}</p>}
            <dl className={styles.summary}>
              <div><dt>Customer code</dt><dd>{opened.order.invoice.customerId}</dd></div>
              <div><dt>Warehouse</dt><dd>{opened.order.profile.location}</dd></div>
              <div><dt>Port destination</dt><dd>{opened.order.invoice.destination || "Needs review"}</dd></div>
              <div><dt>Shipping order / file</dt><dd>{opened.order.invoice.shippingOrder} / {opened.order.invoice.fileNumber}</dd></div>
              <div><dt>Ordered By</dt><dd>{opened.order.invoice.customerOrder || "Missing customer SO"}</dd></div>
              <div><dt>Booking</dt><dd>{opened.order.invoice.booking || "—"}</dd></div>
              <div><dt>Bales</dt><dd>{opened.bol_bales||"Not saved — reopen original reports"}</dd></div>
              <div><dt>Steamship line</dt><dd>{opened.order.invoice.steamship}</dd></div>
              <div><dt>Chassis / seal</dt><dd>{opened.order.invoice.chassis || "—"} / {opened.order.invoice.seal || "—"}</dd></div>
              <div><dt>FirstStar load</dt><dd>{opened.order.invoice.firstStarLoad || "No match"}</dd></div>
              <div><dt>Base billing</dt><dd>${(opened.order.invoice.baseCents/100).toFixed(2)}</dd></div>
              <div><dt>Carrier pay</dt><dd>{opened.order.invoice.carrierCents == null ? "Missing" : `$${(opened.order.invoice.carrierCents/100).toFixed(2)}`}</dd></div>
              <div><dt>Gross margin</dt><dd>{opened.order.invoice.carrierCents == null ? "—" : `$${((opened.order.invoice.cents-opened.order.invoice.carrierCents)/100).toFixed(2)}`}</dd></div>
              <div><dt>Invoice date</dt><dd>{opened.order.invoice.invoiceDate}</dd></div>
              <div><dt>Expected billing</dt><dd>${(opened.order.invoice.cents / 100).toFixed(2)}</dd></div>
              <div><dt>Status</dt><dd>{opened.conflict ? "Source conflict" : opened.order.status}</dd></div>
              <div><dt>SCM order number</dt><dd>{opened.order.order_id || "Not created"}</dd></div>
            </dl>

                        {opened.conflict
                          ? "This warehouse/reference already has a different saved invoice. No changes allowed."
                          : ["delivering", "delivery_uncertain", "delivered"].includes(opened.order.status) ? deliveryNote(opened.order) : opened.order.note}
                        {["delivering", "delivery_uncertain"].includes(opened.order.status) && <button style={button} disabled={busy} onClick={() => act(async () => {
                          const data = await call({ action: "reconcile-delivery", runId: saved.run.id, rowId: opened.order_id }); updateReviewedRow(data);
                        })}>Reconcile delivery (read only)</button>}
                        {bolEligible(opened)&&<section style={{marginTop:16}}><button style={button} disabled={busy} onClick={()=>void downloadBols([opened.order_id],"pdf")}>Download BOL</button><BolImaging key={opened.order_id} runId={saved.run.id} rowId={opened.order_id} orderId={opened.order.order_id} busy={busy} onBusy={setBusy}/></section>}
                        <section>
                          <h3>Charge detail</h3>
                          <ul>
                            {opened.order.invoice.charges.map((c, index) => (
                              <li key={index}>
                                {c.code} — {c.description}: {c.units} · $
                                {(c.cents / 100).toFixed(2)}
                              </li>
                            ))}
                          </ul>
                        </section>
                        {canCorrect && (
                          <form id="dray-correction" aria-label="Review dray source" onSubmit={event => {
                            event.preventDefault();
                            if (busy) return;
                            void act(async () => {
                              const data = await call({action:"save-review", runId:saved.run.id, rowId:opened.order_id, version:opened.order.version, ...review});
                              updateReviewedRow(data); setConfirmed(false); setSuggestions(null);
                            });
                          }}>
                            <h3>Review container and carrier pay</h3>
                            <label>Exact booking number<input style={field} required maxLength={40} value={review.booking}
                              onChange={event => { setReview({...review, booking:event.target.value}); setSuggestions(null); }} /></label>
                            <button type="button" style={button} disabled={busy || !review.booking} onClick={() => void act(async () => {
                              const data = await call({action:"review-suggestions", runId:saved.run.id, rowId:opened.order_id, booking:review.booking});
                              setSuggestions(data.suggestions);
                            })}>Find containers in interchanges</button>
                            {suggestions && (suggestions.length ? <ul>{suggestions.map(candidate => (
                              <li key={candidate.container}><button type="button" style={button} disabled={busy}
                                aria-pressed={review.container === candidate.container}
                                onClick={() => {
                                  setReview({...review, container:candidate.container});
                                  setInterchanges(null);
                                  containerField.current?.focus();
                                }}>{candidate.container}{review.container === candidate.container ? " · Selected" : ""}</button>
                                {candidate.documents.map(direction => direction.toUpperCase()).join(" / ")} · {candidate.differences} character differences
                              </li>
                            ))}</ul> : <p>No container PDFs found for this booking.</p>)}
                            <label>Full container number<input ref={containerField} style={field} required pattern="[A-Za-z]{4}[0-9]{7}" maxLength={11} value={review.container}
                              onChange={event => { setReview({...review, container:event.target.value}); setInterchanges(null); }} /></label>
                            <button type="button" style={button} disabled={busy || !/^[A-Z]{4}\d{7}$/i.test(review.container.trim())} onClick={() => void act(async () => {
                              const data = await call({action:"lookup-interchange-container", runId:saved.run.id, rowId:opened.order_id, container:review.container});
                              setInterchanges(data.interchanges);
                            })}>Find interchange by container</button>
                            {interchanges && (interchanges.length ? <ul>{interchanges.map(match => (
                              <li key={match.booking}>
                                <button type="button" style={button} disabled={busy} onClick={() => {
                                  setReview({...review, booking:match.booking}); setSuggestions(null);
                                }}>Use booking {match.booking}</button>
                                {match.inbound && <a href={match.inbound} target="_blank" rel="noreferrer">IN PDF</a>}
                                {match.outbound && <> · <a href={match.outbound} target="_blank" rel="noreferrer">OUT PDF</a></>}
                              </li>
                            ))}</ul> : <p>No matching interchange PDFs found for this container.</p>)}
                            <label style={{ display:"block", marginTop:16 }}>Verified carrier pay ($)
                              <input style={field} required type="number" inputMode="decimal" min="0.01" step="0.01"
                                value={review.carrierPay} onChange={event => setReview({...review, carrierPay:event.target.value})} />
                            </label>
                          </form>
                        )}
                        {!opened.conflict && opened.order.status === "preview_blocked" && !opened.order.invoice.inputErrors?.length && (
                          <button
                            style={button}
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                const data = await call({
                                  action: "recheck",
                                  runId: saved.run.id,
                                  rowId: opened.order_id,
                                });
                                updateReviewedRow(data);
                              })
                            }
                          >
                            Recheck duplicate search
                          </button>
                        )}
                        {!opened.conflict && opened.order.status === "blocked" && opened.order.order_id && <button style={button} disabled={busy || !writes} onClick={() => {
                          if (!window.confirm(`Complete carrier and reference setup for existing SCM order number ${opened.order.order_id}? Billing will be preserved; no new order or delivery.`)) return;
                          void act(async () => {const data = await call({action:"repair-created",runId:saved.run.id,rowId:opened.order_id,confirmed:true});updateReviewedRow(data);});
                        }}>Complete existing order setup</button>}
                        {!opened.conflict &&
                          [
                            "creating",
                            "creation_uncertain",
                            "created",
                            "rating",
                            "rating_uncertain",
                            "blocked",
                          ].includes(opened.order.status) && (
                            <button
                              style={button}
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  const data = await call({
                                    action: "reconcile",
                                    runId: saved.run.id,
                                    rowId: opened.order_id,
                                  });
                                  updateReviewedRow(data);
                                })
                              }
                            >
                              Reconcile (read only)
                            </button>
                          )}

          </div>
          <footer className={styles.modalFooter} style={{ flexWrap:"wrap", alignItems:"center" }}>
            {canCorrect && error && <p role="alert" className={styles.error} style={{flexBasis:"100%", margin:0}}>{error}</p>}
            {canCorrect && <span className={styles.helper} aria-live="polite" style={{marginRight:"auto"}}>
              {review.container && <>Container {review.container}. </>}
              {!review.carrierPay && "Enter verified carrier pay to save."}
            </span>}
            <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button>
            {canCorrect && <button type="submit" form="dray-correction" className={styles.primary} disabled={busy}>
              {queueOpen ? "Save correction and continue" : "Save correction"}
            </button>}
          </footer>
        </>}
      </dialog>
      <section style={card}>
        <h2>Recent imports</h2>
        {runs.length ? (
          runs.map((run) => (
            <p key={run.id}>
              <button
                style={button}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await refresh(run.id);
                    setConfirmed(false);
                    setSelected(new Set());
                  })
                }
              >
                {run.profile.label} ·{" "}
                {new Date(run.created_at).toLocaleString()}
              </button>
            </p>
          ))
        ) : (
          <p>No saved imports yet.</p>
        )}
      </section>
    </main>
  );
}
