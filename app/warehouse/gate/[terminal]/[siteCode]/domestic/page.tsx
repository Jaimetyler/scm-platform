"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import DomesticFreightNav from "@/components/warehouse/DomesticFreightNav";
import "@/components/warehouse/domestic-tables.css";
import ScmOrderBadge from "@/components/warehouse/ScmOrderBadge";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type Status = "waiting" | "called" | "in_door" | "working";
type YardStatus = Status | "completed" | "cancelled" | null;
type Row = {
  id: string; updated_at: string; checked_in_at: string; driver_name: string | null; driver_phone: string | null;
  movement_direction: string; material_type: string; reference_number: string;
  destination: string | null; shipper: string | null; matched_order_id: string | null;
  comment_1: string | null; mark: string | null; bol_bc: number | null;
  draft_status: string; has_bol_photo: boolean; yard_status: YardStatus;
  yard_called_at: string | null; yard_in_door_at: string | null;
  yard_work_started_at: string | null;
};
type Match = { orderId: string; customerId: string; customerName: string; value: string;
  materialType: "lumber" | "other" | null; destination: string; direction: "pickup" | "delivery" };
type Draft = { id: string; movementDirection: "pickup" | "delivery"; materialType: "lumber" | "other";
  referenceNumber: string; customer: string; driverName: string; driverPhone: string;
  destination: string; notes: string; orderId: string };
function blankDraft(id: string): Draft {
  return { id, movementDirection: "delivery", materialType: "lumber", referenceNumber: "", customer: "",
    driverName: "", driverPhone: "", destination: "", notes: "", orderId: "" };
}
const LABEL: Record<Status, string> = {
  waiting: "Waiting", called: "Called", in_door: "In door", working: "Loading / Unloading",
};

export default function DomesticQueuePage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [working, setWorking] = useState("");
  const [tick, setTick] = useState(0);
  const [matches, setMatches] = useState<Record<string, Match[]>>({});
  const [matchWorking, setMatchWorking] = useState("");
  const [draftMatches, setDraftMatches] = useState<Record<string, Match[]>>({});
  const [draftSearching, setDraftSearching] = useState<Record<string, boolean>>({});
  const draftLookupKeys = useRef<Record<string, string>>({});
  const draftTimers = useRef<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(Array.from({ length: 3 }, (_, index) => blankDraft(`initial-${index}`)));

  function toggleDetails(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const load = useCallback(async (quiet = false) => {
    if (!site) return;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode });
      const response = await fetch(`/api/warehouse/domestic-queue?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load arrivals");
      setRows(result.rows);
      setError("");
      setLoadError(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load arrivals");
      setLoadError(true);
      setRows([]);
    } finally { setLoading(false); }
  }, [site]);

  useEffect(() => {
    if (!editingId) void load();
    const timer = window.setInterval(() => {
      if (!editingId) void load(true);
      setTick((value) => value + 1);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [load, editingId]);

  const searchReference = useCallback(async (reference: string, direction: string, strictDirection = false) => {
    if (!site) throw new Error("Unknown warehouse site");
    const params = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode,
      referenceNumber: reference.trim().toUpperCase(), movementDirection: direction });
    if (strictDirection) params.set("strictDirection", "1");
    const response = await fetch(`/api/warehouse/domestic-queue/match?${params}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "McLeod search failed");
    return result.matches as Match[];
  }, [site]);

  useEffect(() => {
    for (const draft of drafts) {
      const key = `${draft.movementDirection}|${draft.referenceNumber.trim().toUpperCase()}`;
      if (draftLookupKeys.current[draft.id] === key) continue;
      if (draftTimers.current[draft.id]) window.clearTimeout(draftTimers.current[draft.id]);
      draftLookupKeys.current[draft.id] = key;
      setDraftMatches((current) => { const next = { ...current }; delete next[draft.id]; return next; });
      if (draft.referenceNumber.trim().length < 3) {
        setDraftSearching((current) => ({ ...current, [draft.id]: false }));
        continue;
      }
      setDraftSearching((current) => ({ ...current, [draft.id]: true }));
      draftTimers.current[draft.id] = window.setTimeout(async () => {
        delete draftTimers.current[draft.id];
        let resolvedKey = key;
        try {
          const found = await searchReference(draft.referenceNumber, draft.movementDirection);
          if (draftLookupKeys.current[draft.id] !== key) return;
          setDraftMatches((current) => ({ ...current, [draft.id]: found }));
          if (found.length === 1) {
            const match = found[0];
            draftLookupKeys.current[draft.id] = `${match.direction}|${match.value.trim().toUpperCase()}`;
            resolvedKey = draftLookupKeys.current[draft.id];
            setDrafts((current) => current.map((item) => item.id === draft.id &&
              `${item.movementDirection}|${item.referenceNumber.trim().toUpperCase()}` === key ? {
                ...item, movementDirection: match.direction, referenceNumber: match.value,
                customer: match.customerName || match.customerId || item.customer, orderId: match.orderId,
                materialType: match.materialType || item.materialType,
                destination: match.direction === "pickup" ? match.destination || item.destination : item.destination,
              } : item));
          }
        } catch (reason) {
          if (draftLookupKeys.current[draft.id] === key) setError(reason instanceof Error ? reason.message : "McLeod search failed");
        } finally {
          if (draftLookupKeys.current[draft.id] === resolvedKey) {
            setDraftSearching((current) => ({ ...current, [draft.id]: false }));
          }
        }
      }, 600);
    }
  }, [drafts, searchReference]);
  useEffect(() => () => { Object.values(draftTimers.current).forEach(window.clearTimeout); }, []);

  async function transition(row: Row & { yard_status: Status }, to: "checkout" | "cancelled") {
    if (!site || editingId !== row.id) return;
    if (to === "cancelled" && !window.confirm(`Remove ${row.driver_name || row.reference_number} from the domestic queue?`)) return;
    setNotice("");
    setWorking(row.id);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, from: row.yard_status, to,
          action: to === "checkout" ? "checkout" : undefined, terminal: site.terminal, siteCode: site.siteCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not update arrival");
      await load(true);
      setEditingId(null);
      setNotice(to === "checkout" ? `Checked out · ${result.mcleod}` : "Arrival removed");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update arrival"); }
    finally { setWorking(""); }
  }

  async function findOrder(row: Row) {
    if (editingId !== row.id) return;
    setMatchWorking(row.id);
    setError("");
    try {
      const found = await searchReference(row.reference_number, row.movement_direction, true);
      if (found.length === 1) {
        await saveCustomer(row, found[0].customerName || found[0].customerId, found[0].orderId);
      } else setMatches((current) => ({ ...current, [row.id]: found }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "McLeod search failed"); }
    finally { setMatchWorking(""); }
  }

  useEffect(() => {
    if (!editingId) return;
    const row = rows.find((item) => item.id === editingId);
    if (row && !row.matched_order_id && row.reference_number.trim().length >= 3) void findOrder(row);
    // Search once when a saved row is opened for editing. Refreshes do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  async function saveCustomer(row: Row, customer: string, orderId?: string) {
    if (!site || editingId !== row.id || (!orderId && customer.trim().toUpperCase() === (row.shipper ?? ""))) return;
    setWorking(row.id);
    setError("");
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, terminal: site.terminal, siteCode: site.siteCode,
          expectedUpdatedAt: row.updated_at, action: orderId ? "match_order" : "set_customer", customer, orderId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save customer");
      setMatches((current) => { const next = { ...current }; delete next[row.id]; return next; });
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save customer"); }
    finally { setWorking(""); }
  }

  async function saveField(row: Row, field: "reference_number" | "comment_1", value: string) {
    if (!site || editingId !== row.id || value.trim().toUpperCase() === String(row[field] ?? "")) return;
    setWorking(row.id);
    setError("");
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, terminal: site.terminal, siteCode: site.siteCode,
          expectedUpdatedAt: row.updated_at, action: "edit_field", field, value }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save cell");
      setMatches((current) => { const next = { ...current }; delete next[row.id]; return next; });
      await load(true);
      if (field === "reference_number" && value.trim().length >= 3) {
        await findOrder({ ...row, reference_number: value.trim().toUpperCase(), updated_at: result.row.updated_at });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save cell"); }
    finally { setWorking(""); }
  }

  function editDraft(id: string, change: Partial<Draft>) {
    setDrafts((current) => current.map((row) => row.id === id ? {
      ...row, ...change,
      ...("referenceNumber" in change || "movementDirection" in change ? {
        orderId: "", customer: row.orderId ? "" : row.customer,
      } : {}),
    } : row));
  }

  function chooseDraftMatch(draft: Draft, match: Match) {
    draftLookupKeys.current[draft.id] = `${match.direction}|${match.value.trim().toUpperCase()}`;
    setDrafts((current) => current.map((row) => row.id === draft.id ? {
      ...row, movementDirection: match.direction, referenceNumber: match.value, orderId: match.orderId,
      customer: match.customerName || match.customerId || row.customer,
      materialType: match.materialType || row.materialType,
      destination: match.direction === "pickup" ? match.destination || row.destination : row.destination,
    } : row));
  }

  async function saveDraft(draft: Draft) {
    if (!site || !draft.referenceNumber.trim()) {
      setError("Enter the reference number before saving this row.");
      return;
    }
    if (draftSearching[draft.id]) return;
    setWorking(draft.id);
    setError("");
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, terminal: site.terminal, siteCode: site.siteCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save check-in");
      setDrafts((current) => current.filter((row) => row.id !== draft.id));
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save check-in"); }
    finally { setWorking(""); }
  }

  if (!site) return <main><PlatformPageHeader title="Domestic Queue Not Found" /></main>;
  const active = rows.filter((row): row is Row & { yard_status: Status } => row.yard_status === "waiting" || row.yard_status === "called" || row.yard_status === "in_door" || row.yard_status === "working").reverse();
  const recent = rows.filter((row) => !active.some((item) => item.id === row.id));
  const counts = Object.keys(LABEL).map((status) => `${active.filter((row) => row.yard_status === status).length} ${LABEL[status as Status].toLowerCase()}`);
  return <main style={{ width: "100%", maxWidth: "100%", margin: "0 auto", padding: "0 16px", boxSizing: "border-box" }}>
    <PlatformPageHeader title={`${site.siteName} Check-In`}
      subtitle="Lumber and other freight arrivals · check out each truck when it leaves"
      actions={<div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/inbound/checkin" style={utilityLink}>All sites</Link>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/history`} style={utilityLink}>Domestic history</Link>
        <Link href={`/warehouse/inventory/${site.terminalSlug}/${site.siteCode}`} style={utilityLink}>Inventory</Link>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/containers`} style={utilityLink}>Containers</Link>
      </div>} />
    <DomesticFreightNav terminalSlug={site.terminalSlug} siteCode={site.siteCode} current="domestic" />
    {error && <div role="alert" style={{ color: "#fecaca", marginBottom: 14 }}>{error}</div>}
    {notice && <div role="status" style={{ color: "#86efac", marginBottom: 14 }}>{notice}</div>}
    <PlatformPanel style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div><strong style={{ color: "#f8fafc" }}>Lumber & Other</strong><div style={muted}>{counts.join(" · ")}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={primary} onClick={() => setDrafts((current) => [...current, ...Array.from({ length: 5 }, (_, index) => blankDraft(`${Date.now()}-${index}`))])}>+ 5 rows</button>
          <button style={button} onClick={() => void load()}>Refresh</button>
        </div>
      </div>
      {loading ? <p style={muted}>Loading arrivals…</p> : loadError ? null :
        <div style={{ overflowX: "auto" }}>
          <table className="domestic-table" style={{ width: "100%", minWidth: 1180, tableLayout: "fixed", borderCollapse: "collapse", color: "#e2e8f0" }}>
            <colgroup>{[5, 8, 7, 7, 20, 15, 12, 10, 8, 8].map((width, index) =>
              <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead><tr>{["#", "Arrival", "Move", "Material", "Reference / order", "Customer", "Driver", "Destination", "Notes", "Status / action"].map((label) =>
              <th key={label} style={heading}>{label}</th>)}</tr></thead>
            <tbody>{active.map((row, index) => <Fragment key={row.id}><tr style={{ background: editingId === row.id ? "rgba(34,211,238,.06)" : index % 2 ? "rgba(30,41,59,.18)" : undefined }}>
              <td style={cell}>{index + 1}{row.matched_order_id && <div style={{ marginTop: 3 }}><ScmOrderBadge orderId={row.matched_order_id} /></div>}</td>
              <td style={cell}>{time(row.checked_in_at, site.terminal)}</td>
              <td style={cell}>{row.movement_direction}</td>
              <td style={cell}>{row.material_type}</td>
              <td style={cell}><input key={row.updated_at} aria-label={`Reference for ${row.driver_name}`} defaultValue={row.reference_number}
                disabled={editingId !== row.id}
                onBlur={(event) => void saveField(row, "reference_number", event.target.value)} style={sheetInput} /></td>
              <td style={cell}><input key={row.updated_at} aria-label={`Customer for ${row.driver_name}`}
                defaultValue={row.shipper ?? ""} placeholder="Enter customer"
                disabled={editingId !== row.id}
                onBlur={(event) => void saveCustomer(row, event.target.value)} style={sheetInput} /></td>
              <td style={cell}><div style={singleLine} title={row.driver_name || "Staff entry"}>{row.driver_name || "Staff entry"}</div></td>
              <td style={cell}><div style={singleLine} title={row.destination || ""}>{row.destination || "—"}</div></td>
              <td style={cell}><input key={row.updated_at} aria-label={`Notes for ${row.driver_name}`}
                defaultValue={row.comment_1 ?? ""} placeholder="Notes"
                disabled={editingId !== row.id}
                onBlur={(event) => void saveField(row, "comment_1", event.target.value)} style={sheetInput} /></td>
              <td style={cell}><strong style={{ color: "#67e8f9" }}>{LABEL[row.yard_status]}</strong>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                  <button style={button} onClick={() => toggleDetails(row.id)} aria-expanded={expandedIds.has(row.id)}>
                    {expandedIds.has(row.id) ? "Less" : "Details"}</button>
                  {editingId !== row.id ?
                    <button disabled={Boolean(working || matchWorking)} style={button} onClick={() => {
                      setEditingId(row.id); setExpandedIds((current) => new Set(current).add(row.id));
                    }}>Edit</button> : <>
                    <button disabled={working === row.id || matchWorking === row.id} style={button} onClick={() => setEditingId(null)}>Close edit</button>
                    <button disabled={working === row.id} style={primary} onClick={() => void transition(row, "checkout")}>{working === row.id ? "Checking out…" : "Check out"}</button>
                    <button disabled={working === row.id} style={danger} onClick={() => void transition(row, "cancelled")}>Remove</button>
                  </>}
                </div></td>
            </tr>{expandedIds.has(row.id) && <tr style={{ background: "#132337" }}><td colSpan={10} style={detailCell}>
              <div style={detailContent}>
                <span>Arrived {time(row.checked_in_at, site.terminal)} · {elapsed(row.checked_in_at, tick)}</span>
                {row.driver_phone && <span>Driver phone: {row.driver_phone}</span>}
                <Link href={`/warehouse/checkin/${row.id}`} style={detailLink}>{row.has_bol_photo ? "Paperwork and driver details" : "Driver details"}</Link>
                {row.matched_order_id && <span>SCM order #{row.matched_order_id}</span>}
                {editingId === row.id && <button style={inlineButton} disabled={matchWorking === row.id || working === row.id}
                  onClick={() => void findOrder(row)}>{matchWorking === row.id ? "Searching…" : "Find order"}</button>}
                {matches[row.id]?.length === 0 && <span>No matching order</span>}
                {matches[row.id]?.map((match) => <button key={`${match.orderId}-${match.direction}`} style={inlineButton}
                  disabled={editingId !== row.id || working === row.id} onClick={() => void saveCustomer(row, match.customerName, match.orderId)}>
                  #{match.orderId} · {match.customerName || match.customerId} · {match.direction}
                </button>)}
              </div>
            </td></tr>}</Fragment>)}
            {drafts.map((draft, index) => <Fragment key={draft.id}><tr style={{ background: "rgba(51,65,85,.12)" }}>
              <td style={cell}>{active.length + index + 1}</td>
              <td style={cell}><span style={muted}>New row</span></td>
              <td style={cell}><select aria-label="Pickup or delivery" style={sheetInput} value={draft.movementDirection}
                onChange={(event) => editDraft(draft.id, { movementDirection: event.target.value as Draft["movementDirection"] })}>
                <option value="delivery">Delivery</option><option value="pickup">Pickup</option></select></td>
              <td style={cell}><select aria-label="Material" style={sheetInput} value={draft.materialType}
                onChange={(event) => editDraft(draft.id, { materialType: event.target.value as Draft["materialType"] })}>
                <option value="lumber">Lumber</option><option value="other">Other / FAK</option></select></td>
              <td style={cell}><input aria-label="Reference number" style={sheetInput} value={draft.referenceNumber}
                onChange={(event) => editDraft(draft.id, { referenceNumber: event.target.value })} placeholder="Reference *" /></td>
              <td style={cell}><input aria-label="Customer" style={sheetInput} value={draft.customer}
                onChange={(event) => editDraft(draft.id, { customer: event.target.value })} placeholder="Customer" /></td>
              <td style={cell}><input aria-label="Driver name" style={sheetInput} value={draft.driverName}
                onChange={(event) => editDraft(draft.id, { driverName: event.target.value })} placeholder="Driver" /></td>
              <td style={cell}>{draft.movementDirection === "pickup" && <input aria-label="Destination" style={sheetInput} value={draft.destination}
                onChange={(event) => editDraft(draft.id, { destination: event.target.value })} placeholder="Destination" />}</td>
              <td style={cell}><input aria-label="Notes" style={sheetInput} value={draft.notes}
                onChange={(event) => editDraft(draft.id, { notes: event.target.value })} placeholder="Notes" /></td>
              <td style={cell}><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <button style={primary} disabled={working === draft.id || draftSearching[draft.id]} onClick={() => void saveDraft(draft)}>
                  {working === draft.id ? "Saving…" : "Save"}</button>
                <button style={button} onClick={() => toggleDetails(draft.id)} aria-expanded={expandedIds.has(draft.id)}>
                  {expandedIds.has(draft.id) ? "Less" : draftSearching[draft.id] ? "Searching…" : (draftMatches[draft.id]?.length ?? 0) > 1 ? "Review matches" : "More"}
                </button>
              </div></td>
            </tr>{expandedIds.has(draft.id) && <tr style={{ background: "#132337" }}><td colSpan={10} style={detailCell}>
              <div style={detailContent}>
                <label>Driver phone <input aria-label="Driver phone" style={{ ...sheetInput, width: 170, marginLeft: 8 }} value={draft.driverPhone}
                  onChange={(event) => editDraft(draft.id, { driverPhone: event.target.value })} placeholder="Phone" /></label>
                {draftSearching[draft.id] ? <span>Searching McLeod…</span> :
                  draft.orderId ? <span>SCM order #{draft.orderId}</span> :
                  draftMatches[draft.id]?.length === 0 ? <span>No order found · enter details manually</span> : null}
                {!draft.orderId && draftMatches[draft.id]?.length > 1 && draftMatches[draft.id].map((match) =>
                  <button key={`${match.orderId}-${match.direction}`} style={inlineButton} onClick={() => chooseDraftMatch(draft, match)}>
                    #{match.orderId} · {match.customerName || match.customerId} · {match.direction}
                  </button>)}
              </div>
            </td></tr>}</Fragment>)}</tbody>
          </table>
        </div>}
    </PlatformPanel>
    {!loadError && !loading && recent.length > 0 && <p style={{ ...muted, marginTop: 14 }}>
      {recent.length} completed or removed check-ins · <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/history`} style={{ color: "#67e8f9" }}>View history and export</Link>
    </p>}
  </main>;
}

function time(value: string, terminal: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: terminal === "HOU" ? "America/Chicago" : "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function elapsed(value: string, tick: number) {
  void tick;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "just arrived" : `${minutes} min since arrival`;
}
const button: React.CSSProperties = { padding: "8px 11px", borderRadius: 7, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", cursor: "pointer", textDecoration: "none", fontSize: 12, fontWeight: 700 };
const primary: React.CSSProperties = { ...button, background: "#4338ca", borderColor: "#6366f1", color: "#fff" };
const danger: React.CSSProperties = { ...button, color: "#fecaca", borderColor: "#7f1d1d" };
const muted: React.CSSProperties = { color: "#94a3b8", fontSize: 11, marginTop: 4 };
const heading: React.CSSProperties = { padding: "10px 6px", textAlign: "left", borderBottom: "1px solid rgba(148,163,184,.16)", whiteSpace: "nowrap", color: "#a8b8cc", fontSize: 12, background: "rgba(15,23,42,.96)" };
const cell: React.CSSProperties = { padding: "10px 6px", borderBottom: "1px solid rgba(148,163,184,.08)", verticalAlign: "middle" };
const sheetInput: React.CSSProperties = { width: "100%", minWidth: 0, height: 34, boxSizing: "border-box", padding: "4px 6px", border: "1px solid rgba(148,163,184,.18)", borderRadius: 6, background: "rgba(15,23,42,.82)", color: "#e2e8f0", fontSize: 13 };
const utilityLink: React.CSSProperties = { color: "#94a3b8", fontSize: 13, textDecoration: "none", fontWeight: 700 };
const inlineButton: React.CSSProperties = { ...button, padding: "3px 7px", fontSize: 11 };
const singleLine: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const detailCell: React.CSSProperties = { padding: "12px 16px", borderBottom: "1px solid #334155", color: "#cbd5e1", fontSize: 12 };
const detailContent: React.CSSProperties = { display: "flex", gap: "8px 18px", alignItems: "center", flexWrap: "wrap" };
const detailLink: React.CSSProperties = { color: "#67e8f9", textDecoration: "underline" };
