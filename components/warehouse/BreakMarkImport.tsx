"use client";
import { useState } from "react";
import { useCanWrite } from "@/components/auth/StaffSession";
import PlatformPanel from "@/components/platform/PlatformPanel";
import type { BreakMarkRow } from "@/lib/warehouse/break-marks";

type Preview = { rows: BreakMarkRow[]; totalBales: number; skippedZero: number; existingMarks: string[] };
const field = { background: "#102137", color: "#e2e8f0", border: "1px solid #415d77", borderRadius: 8, padding: 10 };
export default function BreakMarkImport({ terminal, siteCode, onImported, sheetEntry = false }: { terminal: string; siteCode: string; onImported: () => Promise<void>; sheetEntry?: boolean }) {
  const canWrite = useCanWrite(terminal);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pasteMode, setPasteMode] = useState(!sheetEntry);
  const [entry, setEntry] = useState([{ mark: "", shippingOrder: "", bales: "" }]);
  const entryText = pasteMode ? text : ["BREAKMARK\tS.O. #\tBALE COUNT",
    ...entry.filter(row => row.mark || row.shippingOrder || row.bales).map(row => [row.mark, row.shippingOrder, row.bales].join("\t"))].join("\n");
  const hasEntries = pasteMode ? Boolean(text.trim()) : entry.some(row => row.mark || row.shippingOrder || row.bales);
  const [customer, setCustomer] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState(terminal === "HOU" ? siteCode === "5300" ? "mckinney" : siteCode === "4331" ? "pasadena" : "" : "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function invalidate() { setPreview(null); setRequestId(""); setMessage(""); setError(""); }
  async function run(action: "preview" | "import") {
    if (!canWrite || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/warehouse/inventory/break-marks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, customer, warehouseLocation: location, quantityColumn: pasteMode ? quantity || undefined : "bales", text: entryText, action, requestId }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || "Could not import break marks.");
      if (action === "preview") { setPreview(result); setRequestId(crypto.randomUUID()); }
      else { setMessage(`${result.created} break marks added · ${result.existing} already imported. Source inventory reconciliation pending.`); setPreview(null); setEntry([{ mark: "", shippingOrder: "", bales: "" }]); setText(""); await onImported(); }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not import break marks."); }
    finally { setBusy(false); }
  }
  if (!canWrite) return null;
  return <PlatformPanel style={{ padding: 16, marginBottom: 18 }}>
    <button type="button" style={field} onClick={() => setOpen(!open)} aria-expanded={open}>{sheetEntry ? "＋ Add break marks" : "＋ Import break marks"}</button>
    {open && <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
      {sheetEntry && <div><button type="button" style={field} disabled={busy} onClick={() => { invalidate(); setPasteMode(!pasteMode); }}>{pasteMode ? "Enter rows" : "Paste from Excel"}</button></div>}
      <p style={{ margin: 0, color: "#a8c3dc" }}>Adding inventory at {terminal} · {siteCode}{terminal === "HOU" && (siteCode === "5300" ? " (McKinney)" : siteCode === "4331" ? " (Pasadena)" : "")}. These become available inventory at this site, tagged as break marks. Source marks will need reconciliation later.</p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label>Customer<br /><input style={field} maxLength={200} value={customer} onChange={e => { invalidate(); setCustomer(e.target.value); }} /></label>
        <label>Warehouse location (optional)<br /><input style={field} maxLength={120} value={location} onChange={e => { invalidate(); setLocation(e.target.value); }} /></label>
        {pasteMode && <label>Quantity to import<br /><select style={field} value={quantity} onChange={e => { invalidate(); setQuantity(e.target.value); }}>
          <option value="">Bale count (unsplit sheets)</option><option value="bales">Total bale count</option><option value="pasadena">Pasadena · 4331 column</option><option value="mckinney">McKinney · 5300 column</option>
        </select></label>}
      </fieldset>
      {pasteMode ? <label>Break mark / S.O. # / Bale count<textarea disabled={busy} style={{ ...field, width: "100%", boxSizing: "border-box", display: "block" }} rows={7} maxLength={150000}
        placeholder={"BREAKMARK\tS.O. #\tBALE COUNT\nRZ024\t52918\t90"} value={text} onChange={e => { invalidate(); setText(e.target.value); }} /></label> : <div style={{ overflowX: "auto" }}>
        <table style={{ textAlign: "left" }}><thead><tr><th>Break mark</th><th>S.O. #</th><th>Bale count</th></tr></thead>
          <tbody>{entry.map((row, index) => <tr key={index}>{(["mark", "shippingOrder", "bales"] as const).map((key, column) => <td key={key}>
            <input aria-label={`${["Break mark", "S.O. #", "Bale count"][column]} row ${index + 1}`} disabled={busy} style={field}
              inputMode={key === "bales" ? "numeric" : undefined} maxLength={key === "bales" ? 7 : key === "mark" ? 80 : 200}
              value={row[key]} onChange={event => { const value = event.target.value; invalidate(); setEntry(current => current.map((item, i) => i === index ? { ...item, [key]: value } : item)); }} />
          </td>)}</tr>)}</tbody></table>
        <button type="button" style={field} disabled={busy || entry.length >= 250} onClick={() => setEntry(current => [...current, { mark: "", shippingOrder: "", bales: "" }])}>Add row</button>
      </div>}
      <div><button type="button" disabled={busy || !customer.trim() || !hasEntries} style={field} onClick={() => void run("preview")}>{busy ? "Working…" : "Preview break marks"}</button></div>
      {preview && <div style={{ overflowX: "auto" }}>
        <p>{preview.rows.length} marks · {preview.totalBales} bales · {preview.skippedZero} zero-quantity rows skipped</p>
        {preview.existingMarks.length > 0 && <p style={{ color: "#fde68a" }}>Existing marks: {preview.existingMarks.join(", ")}. Matching prior imports will be skipped; other inventory conflicts block this import.</p>}
        <table style={{ width: "100%", textAlign: "left" }}><thead><tr><th>Break mark</th><th>Shipping order</th><th>Bales</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.mark}><td>{row.mark}</td><td>{row.shippingOrder || "—"}</td><td>{row.bales}</td></tr>)}</tbody></table>
        <button type="button" disabled={busy} style={{ ...field, marginTop: 14, background: "#0e7490" }} onClick={() => void run("import")}>Add {preview.rows.length} break marks to inventory</button>
      </div>}
      {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}
    </div>}
  </PlatformPanel>;
}
