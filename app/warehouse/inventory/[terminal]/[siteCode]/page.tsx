"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { availableBales, type InventoryStatus, type ReceiptStatus } from "@/lib/warehouse/inventory";

type InventoryRow = {
  id: string;
  updated_at: string;
  received_date: string | null;
  mark: string;
  customer: string;
  bol_bc: number | null;
  original_bales: number;
  current_bales: number;
  allocated_bales: number;
  missing_bales: number;
  warehouse_location: string | null;
  booking_number: string | null;
  inventory_status: InventoryStatus;
  ecotton_receipt_status: ReceiptStatus;
  notes: string | null;
};

type Summary = {
  total_lots: number;
  current_bales: number;
  allocated_bales: number;
  available_bales: number;
  missing_bales: number;
  pending_receipts: number;
};

type EditDraft = {
  currentBales: number;
  allocatedBales: number;
  missingBales: number;
  warehouseLocation: string;
  bookingNumber: string;
  inventoryStatus: InventoryStatus;
  notes: string;
};

const EMPTY_SUMMARY: Summary = {
  total_lots: 0, current_bales: 0, allocated_bales: 0,
  available_bales: 0, missing_bales: 0, pending_receipts: 0,
};

export default function WarehouseInventoryPage() {
  const params = useParams<{ terminal: string; siteCode: string }>();
  const terminalSlug = String(params?.terminal ?? "");
  const siteCode = String(params?.siteCode ?? "");
  const site = useMemo(() => getCheckinSite(terminalSlug, siteCode), [terminalSlug, siteCode]);

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const loadInventory = useCallback(async () => {
    if (!site) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        terminal: site.terminal, siteCode: site.siteCode, status,
        search, page: String(page),
      });
      const response = await fetch(`/api/warehouse/inventory?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load inventory");
      setRows(result.rows as InventoryRow[]);
      setSummary(result.summary as Summary);
      setPageCount(result.pagination.pageCount);
      setTotalRows(result.pagination.totalRows);
      setEditingId(null);
      setDraft(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load inventory");
    } finally {
      setLoading(false);
    }
  }, [site, status, search, page]);

  useEffect(() => { void loadInventory(); }, [loadInventory]);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function beginEdit(row: InventoryRow) {
    setEditingId(row.id);
    setDraft({
      currentBales: row.current_bales,
      allocatedBales: row.allocated_bales,
      missingBales: row.missing_bales,
      warehouseLocation: row.warehouse_location ?? "",
      bookingNumber: row.booking_number ?? "",
      inventoryStatus: row.inventory_status,
      notes: row.notes ?? "",
    });
  }

  async function saveEdit(row: InventoryRow) {
    if (!site || !draft) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/warehouse/inventory/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminal: site.terminal,
          siteCode: site.siteCode,
          expectedUpdatedAt: row.updated_at,
          ...draft,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.row) {
        throw new Error(result.error || "Could not save inventory");
      }
      await loadInventory();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save inventory");
    } finally {
      setSaving(false);
    }
  }

  if (!site) {
    return <main><PlatformPageHeader title="Inventory Site Not Found"
      actions={<Link href="/warehouse/inventory" style={buttonStyle}>Back to Inventory</Link>} /></main>;
  }

  return (
    <main style={{ maxWidth: 1680, margin: "0 auto" }}>
      <PlatformPageHeader
        title={`${site.siteName} Inventory`}
        subtitle="Current cotton inventory by receipt lot. Booking allocations and quantity changes are saved to the inventory ledger."
        actions={<>
          <Link href="/warehouse/inventory" style={buttonStyle}>← All Warehouses</Link>
          <Link href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`} style={buttonStyle}>Check-In</Link>
          <button type="button" onClick={() => void loadInventory()} style={buttonStyle}>Refresh</button>
        </>}
      />

      <div style={statsStyle}>
        <Stat label="Active lots" value={summary.total_lots} />
        <Stat label="Current bales" value={summary.current_bales} />
        <Stat label="Available" value={summary.available_bales} tone="green" />
        <Stat label="Allocated" value={summary.allocated_bales} tone="blue" />
        <Stat label="Missing" value={summary.missing_bales} tone={summary.missing_bales ? "red" : "default"} />
        <Stat label="E-Cotton pending" value={summary.pending_receipts} tone={summary.pending_receipts ? "amber" : "default"} />
      </div>

      <PlatformPanel style={{ padding: 16 }}>
        <form onSubmit={applySearch} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search mark, customer, booking or location" style={{ ...inputStyle, width: 360, maxWidth: "100%" }} />
          <button type="submit" style={primaryButtonStyle}>Search</button>
          {search ? <button type="button" style={buttonStyle} onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}>Clear</button> : null}
          <label style={{ color: "#94a3b8", marginLeft: "auto", fontSize: 13 }}>
            Status&nbsp;
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} style={inputStyle}>
              <option value="open">Open inventory</option>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </label>
        </form>
        {error ? <div style={errorStyle}>{error}</div> : null}
      </PlatformPanel>

      <PlatformPanel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>{[14, 12, 8, 8, 9, 8, 11, 10, 8, 7, 5].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead><tr>
              {['Mark / Customer', 'Received', 'Original', 'Current', 'Available / Alloc.', 'Missing', 'Location', 'Booking #', 'E-Cotton', 'Status', ''].map((label) =>
                <th key={label} style={thStyle}>{label}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const editing = editingId === row.id && draft;
                return <InventoryTableRows key={row.id} row={row} editing={Boolean(editing)} draft={editing ? draft : null}
                  setDraft={setDraft} beginEdit={beginEdit} cancel={() => { setEditingId(null); setDraft(null); }}
                  save={() => void saveEdit(row)} saving={saving} />;
              })}
              {!loading && rows.length === 0 ? <tr><td colSpan={11} style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
                No inventory matches these filters.
              </td></tr> : null}
            </tbody>
          </table>
        </div>
        {loading ? <div style={{ padding: 24, color: "#94a3b8" }}>Loading inventory…</div> : null}
        <div style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(148,163,184,.12)" }}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>{totalRows} matching lot{totalRows === 1 ? "" : "s"}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={smallButtonStyle} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span style={{ color: "#cbd5e1", fontSize: 13 }}>Page {page} of {pageCount}</span>
            <button type="button" style={smallButtonStyle} disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
          </div>
        </div>
      </PlatformPanel>
    </main>
  );
}

function InventoryTableRows(props: {
  row: InventoryRow; editing: boolean; draft: EditDraft | null;
  setDraft: (value: EditDraft | null) => void; beginEdit: (row: InventoryRow) => void;
  cancel: () => void; save: () => void; saving: boolean;
}) {
  const { row, editing, draft, setDraft, beginEdit, cancel, save, saving } = props;
  return <>
    <tr style={{ background: row.inventory_status === "on_hold" ? "rgba(245,158,11,.05)" : undefined }}>
      <td style={tdStyle}><strong>{row.mark}</strong><small style={subStyle}>{row.customer}</small></td>
      <td style={tdStyle}>{row.received_date || "—"}<small style={subStyle}>B/C {row.bol_bc ?? "—"}</small></td>
      <td style={numberCellStyle}>{row.original_bales}</td>
      <td style={numberCellStyle}>{row.current_bales}</td>
      <td style={numberCellStyle}><strong style={{ color: "#86efac" }}>{availableBales(row.current_bales, row.allocated_bales)}</strong><small style={subStyle}>{row.allocated_bales} allocated</small></td>
      <td style={{ ...numberCellStyle, color: row.missing_bales ? "#fca5a5" : "#cbd5e1" }}>{row.missing_bales}</td>
      <td style={tdStyle}>{row.warehouse_location || "—"}</td>
      <td style={tdStyle}>{row.booking_number || "—"}</td>
      <td style={tdStyle}><Pill value={row.ecotton_receipt_status} /></td>
      <td style={tdStyle}><Pill value={row.inventory_status} /></td>
      <td style={tdStyle}><button type="button" onClick={() => beginEdit(row)} disabled={editing} style={smallButtonStyle}>Edit</button></td>
    </tr>
    {editing && draft ? <tr><td colSpan={11} style={{ padding: 14, background: "rgba(30,41,59,.52)", borderBottom: "1px solid rgba(148,163,184,.16)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
        <EditNumber label="Current bales" value={draft.currentBales} onChange={(value) => setDraft({ ...draft, currentBales: value })} />
        <EditNumber label="Allocated" value={draft.allocatedBales} onChange={(value) => setDraft({ ...draft, allocatedBales: value })} />
        <EditNumber label="Missing" value={draft.missingBales} onChange={(value) => setDraft({ ...draft, missingBales: value })} />
        <EditText label="Location" value={draft.warehouseLocation} onChange={(value) => setDraft({ ...draft, warehouseLocation: value.toUpperCase() })} />
        <EditText label="Booking #" value={draft.bookingNumber} onChange={(value) => setDraft({ ...draft, bookingNumber: value.toUpperCase() })} />
        <label style={labelStyle}>Status<select value={draft.inventoryStatus} onChange={(event) => setDraft({ ...draft, inventoryStatus: event.target.value as InventoryStatus })} style={inputStyle}>
          <option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed</option>
        </select></label>
        <label style={{ ...labelStyle, gridColumn: "span 2" }}>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} style={{ ...inputStyle, minHeight: 62, resize: "vertical" }} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" onClick={save} disabled={saving} style={primaryButtonStyle}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" onClick={cancel} disabled={saving} style={buttonStyle}>Cancel</button>
        <span style={{ color: "#94a3b8", fontSize: 12, alignSelf: "center" }}>Available after save: {availableBales(draft.currentBales, draft.allocatedBales)}</span>
      </div>
    </td></tr> : null}
  </>;
}

function EditNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label style={labelStyle}>{label}<input type="number" min={0} step={1} value={value}
    onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} style={inputStyle} /></label>;
}
function EditText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label style={labelStyle}>{label}<input value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} /></label>;
}
function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "green" | "blue" | "red" | "amber" }) {
  const colors = { default: "#f8fafc", green: "#86efac", blue: "#93c5fd", red: "#fca5a5", amber: "#fde68a" };
  return <div style={statCardStyle}><div style={{ color: "#94a3b8", fontSize: 12 }}>{label}</div><div style={{ color: colors[tone], fontSize: 27, fontWeight: 900, marginTop: 8 }}>{value.toLocaleString()}</div></div>;
}
function Pill({ value }: { value: string }) {
  return <span style={{ display: "inline-block", padding: "4px 7px", borderRadius: 999, background: "rgba(148,163,184,.12)", border: "1px solid rgba(148,163,184,.2)", fontSize: 10, fontWeight: 800, textTransform: "capitalize" }}>{value.replaceAll("_", " ")}</span>;
}

const statsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 22 };
const statCardStyle: React.CSSProperties = { padding: 15, borderRadius: 15, background: "rgba(15,23,42,.72)", border: "1px solid rgba(148,163,184,.15)" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "10px 8px", color: "#94a3b8", fontSize: 11, borderBottom: "1px solid rgba(148,163,184,.18)", background: "rgba(15,23,42,.96)" };
const tdStyle: React.CSSProperties = { padding: "9px 8px", color: "#e2e8f0", fontSize: 12, borderBottom: "1px solid rgba(148,163,184,.09)", verticalAlign: "top", overflowWrap: "anywhere" };
const numberCellStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const subStyle: React.CSSProperties = { display: "block", color: "#94a3b8", fontSize: 10, marginTop: 3 };
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, color: "#94a3b8", fontSize: 11, fontWeight: 800 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 36, padding: "7px 9px", borderRadius: 7, border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.72)", color: "#e2e8f0", boxSizing: "border-box" };
const buttonStyle: React.CSSProperties = { padding: "9px 12px", minHeight: 36, borderRadius: 8, border: "1px solid rgba(148,163,184,.24)", background: "rgba(15,23,42,.86)", color: "#e2e8f0", fontWeight: 800, cursor: "pointer" };
const primaryButtonStyle: React.CSSProperties = { ...buttonStyle, border: "1px solid rgba(99,102,241,.46)", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white" };
const smallButtonStyle: React.CSSProperties = { ...buttonStyle, minHeight: 29, padding: "4px 8px", fontSize: 11 };
const errorStyle: React.CSSProperties = { marginTop: 12, padding: 10, borderRadius: 8, color: "#fecaca", background: "rgba(127,29,29,.24)", border: "1px solid rgba(239,68,68,.28)" };
