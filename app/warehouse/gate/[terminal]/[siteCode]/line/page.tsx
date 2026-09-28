"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import ScmOrderBadge from "@/components/warehouse/ScmOrderBadge";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";

type Status = "waiting" | "called" | "in_door" | "working";
type Arrival = {
  id: string; checked_in_at: string; driver_name: string | null; movement_direction: string | null;
  material_type: string; reference_number: string | null; mark: string | null;
  shipper: string | null; yard_status: Status | "completed" | "cancelled" | null;
  updated_at: string; matched_order_id: string | null; carrier_code?: string | null; scm_carrier?: boolean;
  draft_status: string; bol_bc: number | null; bale_count: number | null;
  warehouse_location: string | null; equipment_type: string | null;
};
type CottonFields = { mark: string; customer: string; bolBC: string; baleCount: string; warehouseLocation: string; equipmentType: string };
const LABEL: Record<Status, string> = {
  waiting: "Waiting", called: "Called", in_door: "In door", working: "Loading / Unloading",
};

export default function DomesticLinePage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const site = getCheckinSite(params.terminal, params.siteCode);
  const [rows, setRows] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const [cottonEditId, setCottonEditId] = useState<string | null>(null);
  const [cottonFields, setCottonFields] = useState<Record<string, CottonFields>>({});

  const load = useCallback(async () => {
    if (!site) return;
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode, view: "line" });
      const response = await fetch(`/api/warehouse/domestic-queue?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the domestic line");
      setRows(result.rows);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the domestic line"); }
    finally { setLoading(false); }
  }, [site]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!working) void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load, working]);

  function openCotton(row: Arrival) {
    setCottonFields((current) => ({ ...current, [row.id]: {
      mark: row.mark || "", customer: row.shipper || "", bolBC: String(row.bol_bc ?? ""),
      baleCount: String(row.bale_count ?? ""), warehouseLocation: row.warehouse_location || "",
      equipmentType: row.equipment_type || (site?.terminal === "SAV" ? "V" : ""),
    } }));
    setCottonEditId(row.id);
  }
  function changeCotton(id: string, field: keyof CottonFields, value: string) {
    setCottonFields((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  async function move(row: Arrival & { yard_status: Status }, to: "checkout" | "cancelled", cotton?: CottonFields) {
    if (!site || working) return;
    if (to === "cancelled" && !window.confirm(`Remove ${row.driver_name || row.reference_number || row.mark} from the line?`)) return;
    setNotice("");
    setWorking(row.id);
    try {
      const response = await fetch("/api/warehouse/domestic-queue", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, from: row.yard_status, to, action: to === "checkout" ? "checkout" : undefined,
          expectedUpdatedAt: row.updated_at, cotton,
          terminal: site.terminal, siteCode: site.siteCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not update this arrival");
      await load();
      setCottonEditId(null);
      setNotice(to === "checkout" ? `Checked out · ${result.mcleod}` : "Arrival removed");
    } catch (reason) {
      await load();
      setError(reason instanceof Error ? reason.message : "Could not update this arrival");
    }
    finally { setWorking(""); }
  }

  if (!site) return <main><PlatformPageHeader title="Domestic Line Not Found" /></main>;
  const active = rows.filter((row): row is Arrival & { yard_status: Status } =>
    row.yard_status === "waiting" || row.yard_status === "called" || row.yard_status === "in_door" || row.yard_status === "working")
    .sort((a, b) => new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime() || a.id.localeCompare(b.id));
  const waiting = active.filter((row) => row.yard_status === "waiting").length;
  const nextWaitingId = active.find((row) => row.yard_status === "waiting")?.id;
  const time = (value: string) => new Date(value).toLocaleTimeString("en-US", {
    timeZone: site.terminal === "HOU" ? "America/Chicago" : "America/New_York", hour: "numeric", minute: "2-digit",
  });
  return <main style={{ width: "100%", padding: "0 12px", boxSizing: "border-box" }}>
    <PlatformPageHeader title={`${site.siteName} Domestic Line`}
      subtitle="Cotton, lumber, and other freight in arrival order. Check out when a truck leaves the yard."
      actions={<Link href="/warehouse/gate" style={button}>All gate sites</Link>} />
    <nav aria-label="Freight views" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <span aria-current="page" style={primary}>Domestic Line</span>
      <Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={button}>Cotton grid</Link>
      <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/domestic`} style={button}>Lumber & Other grid</Link>
      <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/history`} style={button}>History & Excel export</Link>
    </nav>
    {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
    {notice && <p role="status" style={{ color: "#86efac" }}>{notice}</p>}
    <PlatformPanel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <strong>{waiting} waiting · {active.length} active</strong>
        <button style={button} onClick={() => void load()}>Refresh</button>
      </div>
      {loading ? <p>Loading arrivals…</p> : active.length === 0 ? <p>No active domestic arrivals.</p> :
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse", color: "#e2e8f0" }}>
          <thead><tr>{["#", "Arrived", "Freight", "Move", "Driver", "Reference / mark", "Customer", "SCM / order", "Yard status", "Action"].map((name) =>
            <th key={name} style={heading}>{name}</th>)}</tr></thead>
          <tbody>{active.map((row, index) => <Fragment key={row.id}><tr style={{ background: row.id === nextWaitingId ? "rgba(34,211,238,.12)" : undefined }}>
            <td style={cell}>{index + 1}{row.matched_order_id && <div style={{ marginTop: 3 }}><ScmOrderBadge orderId={row.matched_order_id} /></div>}</td>
            <td style={cell}>{time(row.checked_in_at)}</td>
            <td style={cell}>{row.material_type === "cotton" ? "Cotton" : row.material_type === "lumber" ? "Lumber" : "Other"}</td>
            <td style={cell}>{row.movement_direction || "—"}</td>
            <td style={cell}>{row.driver_name || "Staff entry"}</td>
            <td style={cell}>{row.reference_number || row.mark || "—"}</td>
            <td style={cell}>{row.shipper || "—"}</td>
            <td style={cell}>{row.scm_carrier && <strong style={{ color: "#86efac", display: "block" }}>SCM carrier</strong>}
              {row.matched_order_id ? <span>McLeod #{row.matched_order_id}</span> : "—"}
              {row.carrier_code && <small style={{ display: "block", color: "#94a3b8" }}>Carrier {row.carrier_code}</small>}</td>
            <td style={cell}>{LABEL[row.yard_status]}{row.id === nextWaitingId ? <div style={{ color: "#67e8f9", fontSize: 12 }}>Next in line</div> : null}</td>
            <td style={cell}><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <button disabled={Boolean(working)} style={primary} onClick={() => row.material_type === "cotton" && row.movement_direction === "delivery" && !["processed", "outside_carrier"].includes(row.draft_status)
                ? openCotton(row) : void move(row, "checkout")}>{working === row.id ? "Checking out…" : row.material_type === "cotton" && row.movement_direction === "delivery" && !["processed", "outside_carrier"].includes(row.draft_status) ? "Finish cotton" : "Check out"}</button>
              <button disabled={Boolean(working)} style={button} onClick={() => void move(row, "cancelled")}>Remove</button>
            </div></td>
          </tr>{cottonEditId === row.id && cottonFields[row.id] && <tr><td colSpan={10} style={{ ...cell, background: "#132337" }}>
            <form onSubmit={(event) => { event.preventDefault(); void move(row, "checkout", cottonFields[row.id]); }}>
              <strong>Finish cotton delivery · McLeod {row.matched_order_id ? `#${row.matched_order_id}` : "order search at completion"}</strong>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                {([ ["Mark", "mark"], ["Customer", "customer"], ["BOL bale count", "bolBC"],
                  ["Bales unloaded", "baleCount"], ["Warehouse location", "warehouseLocation"] ] as [string, keyof CottonFields][]).map(([label, field]) =>
                  <label key={field} style={{ display: "grid", gap: 5, fontSize: 12 }}>{label}
                    <input required inputMode={field === "bolBC" || field === "baleCount" ? "numeric" : "text"}
                      value={cottonFields[row.id][field]} onChange={(event) => changeCotton(row.id, field, event.target.value)} style={input} />
                  </label>)}
                <label style={{ display: "grid", gap: 5, fontSize: 12 }}>Equipment
                  <select required value={cottonFields[row.id].equipmentType} onChange={(event) => changeCotton(row.id, "equipmentType", event.target.value)} style={input}>
                    <option value="">Select</option><option value="V">Van</option><option value="F">Flatbed</option>
                  </select></label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={Boolean(working)} style={primary}>{working === row.id ? "Finishing…" : "Process delivery & check out"}</button>
                <button type="button" disabled={Boolean(working)} style={button} onClick={() => setCottonEditId(null)}>Cancel</button>
              </div>
            </form>
          </td></tr>}</Fragment>)}</tbody>
        </table></div>}
    </PlatformPanel>
  </main>;
}

const button: React.CSSProperties = { padding: "8px 11px", border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", borderRadius: 7, textDecoration: "none", cursor: "pointer" };
const primary: React.CSSProperties = { ...button, background: "#0e7490", borderColor: "#0e7490", color: "#fff" };
const heading: React.CSSProperties = { padding: "10px 8px", textAlign: "left", borderBottom: "2px solid #475569", whiteSpace: "nowrap" };
const cell: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid #334155", verticalAlign: "top" };
const input: React.CSSProperties = { padding: "8px", borderRadius: 6, border: "1px solid #475569", background: "#0b1220", color: "white", minWidth: 130 };
