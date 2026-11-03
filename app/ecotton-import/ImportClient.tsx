"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./review.module.css";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (openedId && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!openedId && dialog.current?.open) dialog.current.close();
  }, [openedId]);
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [profileId, setProfile] = useState("HOU-HOUWHSE");
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
  const [deliveryPreview, setDeliveryPreview] = useState<any[]>([]);
  useEffect(() => { setDeliveryPreview([]); setOpenedId(null); setQuery(""); setFilter("all"); }, [saved?.run.id]);
  async function call(body?: any, runId?: string) {
    const res = await fetch(
      "/api/ecotton-import" +
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
  const category = (item: any) => item.conflict ? "attention" :
    ["ready", "created"].includes(item.order.status) ? "ready" :
    ["verified", "delivered"].includes(item.order.status) ? "imported" : "attention";
  const visible = items.filter((item: any) => {
    const i = item.order.invoice;
    return (filter === "all" || category(item) === filter) &&
      [i.reference, i.mark, i.customerName, i.customerId, item.order.order_id, item.order.status]
        .some(value => String(value || "").toLowerCase().includes(query.trim().toLowerCase()));
  });
  const opened = items.find((item: any) => item.order_id === openedId);
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
      try {
        for (const preview of deliveryPreview) {
          const data = await call({ action: "deliver", runId: saved.run.id, rowId: preview.rowId, confirmed: true, planHash: preview.planHash });
          setSaved(data);
          if (data.items.find((x) => x.order_id === preview.rowId)?.order.status !== "delivered")
            throw new Error("Delivery stopped for review. Reconcile this row before continuing.");
        }
      } finally {
        setDeliveryPreview([]);
        await refresh(saved.run.id);
      }
    });
  }
  async function execute() {
    if (!confirmed || !chosen.length || !writes) return;
    if (
      !window.confirm(
        `Create/rate ${chosen.length} selected orders from this reviewed import? Existing verified orders will be skipped. Delivery status will not be changed.`,
      )
    )
      return;
    await act(async () => {
      for (const item of chosen) {
        try {
          const data = await call({
            action: "execute",
            runId: saved.run.id,
            rowId: item.order_id,
            confirmed: true,
          });
          setSaved(data);
          const current = data.items.find((x) => x.order_id === item.order_id);
          if (current?.order.status !== "verified")
            throw new Error(
              "Processing stopped for review. Refresh and inspect this row before continuing.",
            );
        } catch (e) {
          await refresh(saved.run.id);
          throw e;
        }
      }
      await refresh();
    });
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
      <h1>eCotton Order Import</h1>
      <p>
        Upload untouched warehouse reports, review duplicate checks, then create
        and rate orders. Verified Houston orders can then be delivered using their saved scheduled dates.
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
        <h2>Warehouse reports</h2>
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
        {profiles.find((p) => p.id === profileId) && (
          <p>
            Pickup and delivery:{" "}
            {profiles.find((p) => p.id === profileId)?.location ||
              "Needs setup"}{" "}
            · Type: ECOTTON · Invoice total saved in each order’s planning
            comment.
          </p>
        )}
        <label htmlFor="import-summary">Original billing summary</label>
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
        <label htmlFor="import-detail">Original billing charge detail</label>
        <input
          id="import-detail"
          type="file"
          accept=".csv,text/csv"
          style={field}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setSaved(null);
            setConfirmed(false);
            setSelected(new Set());
            setDetail("");
            if (file) {
              if (file.size > 2000000) {
                setError("Detail exceeds 2 MB.");
                return;
              }
              file.text().then((text) => {
                setDetail(text);
                setNames((n) => ({ ...n, detail: file.name }));
              });
            }
          }}
        />
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
                summaryCSV: summary,
                detailCSV: detail,
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
            {ready.length} eligible to process · {chosen.length} selected
          </p>
          <p>
            Saved run: {saved.run.id}. A repeated upload reopens its ledger.
            Conflicts, incomplete searches and uncertain writes require review.
          </p>
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
            Create and rate selected orders ({chosen.length})
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
          <div className={styles.toolbar}>
            <input aria-label="Search import orders" placeholder="Search customer, reference, mark or McLeod ID" value={query} onChange={e => setQuery(e.target.value)} />
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
                    "Reference / mark",
                    "Customer",
                    "Invoice date",
                    "Expected",
                    "State / McLeod ID",
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
                          (["ready", "created"].includes(o.status) || (o.status === "verified" && o.profile.id === profileId)) && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${i.reference}`}
                              checked={selected.has(item.order_id)}
                              disabled={busy || !writes}
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
                        {i.charges.length} charges
                      </td>
                      <td>
                        {item.conflict ? "SOURCE CONFLICT" : o.status}
                        <br />
                        {o.order_id || "Not created"}
                      </td>
                      <td><button style={button} onClick={(event) => { opener.current = event.currentTarget; setOpenedId(item.order_id); }}>View details</button></td>
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
        onClose={() => { setOpenedId(null); opener.current?.focus(); }}>
        {opened && <>
          <header className={styles.modalHeader}>
            <div><span className={styles.eyebrow}>IMPORT ORDER</span><h2 id="import-detail-title">{opened.order.invoice.customerName}</h2><p>{opened.order.invoice.reference} · {opened.order.invoice.mark}</p></div>
            <button aria-label="Close order details" disabled={busy} onClick={() => dialog.current?.close()}>×</button>
          </header>
          <div className={styles.modalBody}>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <dl className={styles.summary}>
              <div><dt>Customer code</dt><dd>{opened.order.invoice.customerId}</dd></div>
              <div><dt>Warehouse</dt><dd>{opened.order.profile.location}</dd></div>
              <div><dt>Invoice date</dt><dd>{opened.order.invoice.invoiceDate}</dd></div>
              <div><dt>Expected billing</dt><dd>${(opened.order.invoice.cents / 100).toFixed(2)}</dd></div>
              <div><dt>Status</dt><dd>{opened.conflict ? "Source conflict" : opened.order.status}</dd></div>
              <div><dt>McLeod ID</dt><dd>{opened.order.order_id || "Not created"}</dd></div>
            </dl>

                        {opened.conflict
                          ? "This warehouse/reference already has a different saved invoice. No changes allowed."
                          : ["delivering", "delivery_uncertain", "delivered"].includes(opened.order.status) ? deliveryNote(opened.order) : opened.order.note}
                        {["delivering", "delivery_uncertain"].includes(opened.order.status) && <button style={button} disabled={busy} onClick={() => act(async () => {
                          const data = await call({ action: "reconcile-delivery", runId: saved.run.id, rowId: opened.order_id }); setSaved(data);
                        })}>Reconcile delivery (read only)</button>}
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
                        {!opened.conflict && opened.order.status === "preview_blocked" && (
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
                                setSaved(data);
                              })
                            }
                          >
                            Recheck duplicate search
                          </button>
                        )}
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
                                  setSaved(data);
                                })
                              }
                            >
                              Reconcile (read only)
                            </button>
                          )}

          </div>
          <footer className={styles.modalFooter}><button disabled={busy} onClick={() => dialog.current?.close()}>Close</button></footer>
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
