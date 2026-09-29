"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

type Preview = { booking: { bookingNumber: string; customer: string; customerReference: string; containers: number | null;
  totalBales: number; warnings: string[]; lines: { sourceRow: number; mark: string; loadBy: string; shippingOrder: string;
    warehouse: string; warehouseCode: string; bales: number; confirmed: boolean }[] }; mismatches: { row: number; warehouse: string }[] };
type Booking = { id: string; booking_number: string; customer: string; requested_bales: number; planned_containers: number | null; status: string };
type Detail = { booking: Booking; lines: { source_row: number; mark: string; requested_bales: number; load_by: string;
  shipping_order: string; available_bales: number; mark_requested_total: number; inventory_locations: string[] }[] };
const sites = CHECKIN_SITES.filter((site) => site.materials.includes("cotton"));
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
const button: React.CSSProperties = { ...input, cursor: "pointer", fontWeight: 700 };
export default function CottonOutboundPage() {
  const [siteKey, setSiteKey] = useState("");
  const site = sites.find((item) => `${item.terminal}:${item.siteCode}` === siteKey);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const list = useCallback(async () => {
    if (!site) return;
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBookings(result.bookings);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load bookings"); }
  }, [site]);
  useEffect(() => { void list(); }, [list]);
  async function upload(event: FormEvent, save: boolean) {
    event.preventDefault();
    if (!site || !file) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.set("file", file); body.set("terminal", site.terminal); body.set("siteCode", site.siteCode);
      const response = await fetch(save ? "/api/warehouse/outbound/bookings" : "/api/warehouse/outbound/preview", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (save) {
        setMessage(`Saved booking ${preview?.booking.bookingNumber} as a draft.`);
        setPreview(null); setFile(null); await list(); await openDetail(result.id);
      } else setPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not process booking"); }
    finally { setWorking(false); }
  }
  async function openDetail(id: string) {
    if (!site) return;
    try {
      const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDetail(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open booking"); }
  }
  return <main style={{ maxWidth: 1500, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title="Cotton Outbound" subtitle="Review booking requests and match requested marks to warehouse inventory."
      actions={<Link href="/warehouse/inventory" style={button}>← Inventory</Link>} />
    <PlatformPanel><div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <label>Warehouse <select style={input} value={siteKey} onChange={(e) => {
        setSiteKey(e.target.value); setPreview(null); setDetail(null); setBookings([]); setError(""); }}>
        <option value="">Choose a warehouse</option>{sites.map((item) => <option key={`${item.terminal}:${item.siteCode}`} value={`${item.terminal}:${item.siteCode}`}>{item.siteName}</option>)}
      </select></label>
      <form onSubmit={(event) => void upload(event, false)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="file" accept=".xlsx" disabled={!site} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        <button style={button} disabled={!site || !file || working}>Review Bunge request</button>
      </form>
    </div><p style={{ color: "#94a3b8" }}>Importing creates a draft. Inventory balances do not change during review.</p>
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}
    </PlatformPanel>
    {preview && <PlatformPanel><h2>{preview.booking.bookingNumber} · {preview.booking.customer}</h2>
      <p>{preview.booking.lines.length} marks · {preview.booking.totalBales} bales · {preview.booking.containers ?? "—"} containers · Customer ref {preview.booking.customerReference || "—"}</p>
      {preview.mismatches.length > 0 && <p role="alert" style={{ color: "#fca5a5" }}>Warehouse mismatch: {preview.mismatches.map((item) => `row ${item.row}: ${item.warehouse}`).join("; ")}. Choose the correct warehouse request before saving.</p>}
      {preview.booking.warnings.map((warning) => <p key={warning} style={{ color: "#fbbf24" }}>{warning}</p>)}
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}><thead><tr>{["Row", "Mark", "Bales", "Load by", "Confirmed", "S.O.", "Warehouse code", "Warehouse"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {preview.booking.lines.map((line) => <tr key={line.sourceRow}><td>{line.sourceRow}</td><td>{line.mark}</td><td>{line.bales}</td><td>{line.loadBy}</td><td>{line.confirmed ? "Yes" : "No"}</td><td>{line.shippingOrder}</td><td>{line.warehouseCode}</td><td>{line.warehouse}</td></tr>)}
      </tbody></table></div>
      <button style={button} disabled={working || !!preview.mismatches.length || !!preview.booking.warnings.length} onClick={(event) => void upload(event, true)}>Save draft booking</button>
    </PlatformPanel>}
    {site && <PlatformPanel><h2>Bookings at {site.siteName}</h2>
      {bookings.length === 0 ? <p>No bookings imported yet.</p> : bookings.map((item) => <button key={item.id} style={{ ...button, display: "block", width: "100%", textAlign: "left", marginBottom: 8 }} onClick={() => void openDetail(item.id)}>
        {item.booking_number} · {item.customer} · {item.requested_bales} bales · {item.planned_containers ?? "—"} containers · {item.status}
      </button>)}
    </PlatformPanel>}
    {detail && <PlatformPanel><h2>{detail.booking.booking_number} · Inventory check</h2><p>Available is unallocated, active inventory for this mark at the selected warehouse. No bales have been reserved or shipped.</p>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}><thead><tr>{["Mark", "Requested", "Available", "Difference", "Load by", "S.O.", "Location"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {detail.lines.map((line) => <tr key={line.source_row}><td>{line.mark}</td><td>{line.requested_bales}</td><td>{line.available_bales}</td><td style={{ color: line.available_bales < line.mark_requested_total ? "#fca5a5" : "#86efac" }}>{line.available_bales - line.mark_requested_total}{line.mark_requested_total !== line.requested_bales ? " (all rows for mark)" : ""}</td><td>{line.load_by}</td><td>{line.shipping_order || "—"}</td><td>{line.inventory_locations.join(", ") || "—"}</td></tr>)}
      </tbody></table></div>
    </PlatformPanel>}
  </main>;
}
