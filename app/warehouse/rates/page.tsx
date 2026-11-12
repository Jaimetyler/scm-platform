"use client";

import { useEffect, useState, type FormEvent } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { useWarehouseWorkspace } from "@/components/warehouse/WarehouseWorkspace";
import { CHECKIN_SITES, TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import { fuelModes, rateColumns, rateModes, type ServiceRate } from "@/lib/dray/service-rates";

const field = { padding: "8px 10px", border: "1px solid #475569", borderRadius: 6, background: "#0f172a", color: "#e2e8f0" };
const blank = { terminal: "DAL", site_code: "", customer_code: "", revenue_code: "DDRAY", service_type: "drayage",
  fuel_mode: "all_in", base_rate: "", included_chassis_days: "0", chassis_daily_rate: "0", active: "true", notes: "" };
type Draft = typeof blank;
const key = (rate: ServiceRate) => [rate.terminal, rate.site_code, rate.customer_code, rate.revenue_code, rate.service_type].join("|");
const usd = (amount: number | null) => amount == null ? "—" : Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
const siteLabel = (terminal: string, code: string) => code ? CHECKIN_SITES.find(site => site.terminal === terminal && site.siteCode === code)?.siteName ?? code : "Terminal default";

export default function WarehouseRates() {
  const { location } = useWarehouseWorkspace();
  const [rates, setRates] = useState<ServiceRate[]>([]);
  const [mode, setMode] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/warehouse/rates", { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Could not load rates.");
    if (!signal?.aborted) setRates(result.rates);
  }

  useEffect(() => {
    const request = new AbortController();
    void load(request.signal).catch(reason => {
      if (!request.signal.aborted) setError(String(reason.message || reason));
    }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, []);

  function edit(rate?: ServiceRate) {
    setEditing(Boolean(rate)); setError(""); setMessage("");
    if (rate) {
      setDraft(Object.fromEntries(rateColumns.map(column => [column, String(rate[column] ?? "")])) as Draft);
    } else {
      setDraft({ ...blank, terminal: location.terminal === "all" ? "DAL" : location.terminal,
        site_code: location.siteCode === "all" ? "" : location.siteCode, service_type: mode || blank.service_type,
        revenue_code: location.terminal === "DAL" || location.terminal === "all" ? "DDRAY" : "" });
    }
  }

  async function save(event: FormEvent, importing = false) {
    event.preventDefault();
    if (busy || (importing ? !file : !draft)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const upload = new FormData();
      if (importing && file) upload.set("file", file);
      const response = await fetch("/api/warehouse/rates", { method: "POST",
        ...(importing ? { body: upload } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates: [draft] }) }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not save rates.");
      setDraft(null); setFile(null); setShowImport(false);
      setMessage(`${result.count} rate${result.count === 1 ? "" : "s"} saved.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save rates."); }
    finally { setBusy(false); }
  }

  const visible = rates.filter(rate => (location.terminal === "all" || rate.terminal === location.terminal)
    && (location.siteCode === "all" || !rate.site_code || rate.site_code === location.siteCode)
    && (!mode || rate.service_type === mode));
  const change = (name: keyof Draft, value: string) => setDraft(current => current && { ...current, [name]: value });
  return <main style={{ maxWidth: 1420, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title="Rates" subtitle="Customer rates by warehouse, mode, and McLeod revenue code."
      actions={<><button type="button" style={field} disabled={busy} onClick={() => edit()}>Add rate</button>
        <button type="button" style={field} disabled={busy} onClick={() => setShowImport(open => !open)}>Import rates</button></>} />
    <PlatformPanel style={{ padding: 16 }}>
      <label>Mode <select style={field} value={mode} onChange={event => setMode(event.target.value)}>
        <option value="">All modes</option>{rateModes.map(item => <option key={item}>{item}</option>)}
      </select></label>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      {showImport && <form onSubmit={event => void save(event, true)} style={{ marginTop: 16 }}>
        <p>Upload a CSV or XLSX with these headers. A blank site code applies the rate across the terminal. Matching rows are updated.</p>
        <code style={{ overflowWrap: "anywhere" }}>{rateColumns.join(",")}</code>
        <p>Modes: {rateModes.join(", ")}. Fuel values: {Object.keys(fuelModes).join(", ")}. Leave base rate blank to use McLeod for the comparison.</p>
        <input aria-label="Rate import file" type="file" accept=".csv,.xlsx" onChange={event => setFile(event.target.files?.[0] ?? null)} />
        <button style={field} disabled={busy || !file}>Import and save</button>
      </form>}
      {draft && <form onSubmit={event => void save(event)} style={{ marginTop: 16 }}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <label>Terminal <select style={field} disabled={editing} value={draft.terminal}
            onChange={event => setDraft({ ...draft, terminal: event.target.value, site_code: "" })}>
            {Object.entries(TERMINAL_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select></label>
          <label>Warehouse <select style={field} disabled={editing} value={draft.site_code} onChange={event => change("site_code", event.target.value)}>
            <option value="">Terminal default</option>
            {CHECKIN_SITES.filter(site => site.terminal === draft.terminal).map(site => <option key={site.siteCode} value={site.siteCode}>{site.siteName}</option>)}
          </select></label>
          <label>Mode <select style={field} disabled={editing} value={draft.service_type} onChange={event => change("service_type", event.target.value)}>
            {rateModes.map(item => <option key={item}>{item}</option>)}
          </select></label>
          {([["customer_code", "McLeod customer code"], ["revenue_code", "Revenue code"]] as const).map(([name, label]) =>
            <label key={name}>{label} <input style={{ ...field, width: "100%", boxSizing: "border-box" }} required disabled={editing} maxLength={30} value={draft[name]} onChange={event => change(name, event.target.value)} /></label>)}
          <label>Fuel treatment <select style={{ ...field, maxWidth: "100%" }} value={draft.fuel_mode} onChange={event => change("fuel_mode", event.target.value)}>
            {Object.entries(fuelModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {([["base_rate", "Base rate per order"], ["included_chassis_days", "Included chassis days"], ["chassis_daily_rate", "Chassis daily rate"]] as const).map(([name, label]) =>
            <label key={name}>{label} <input style={{ ...field, width: "100%", boxSizing: "border-box" }} required={name !== "base_rate"}
              type="number" min="0" step={name === "included_chassis_days" ? "1" : "0.01"} value={draft[name]} onChange={event => change(name, event.target.value)} /></label>)}
          <label>Notes <input style={{ ...field, width: "100%", boxSizing: "border-box" }} maxLength={1000} value={draft.notes} onChange={event => change("notes", event.target.value)} /></label>
          <label><input type="checkbox" checked={draft.active === "true"} onChange={event => change("active", String(event.target.checked))} /> Active</label>
        </fieldset>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={field} disabled={busy}>Save rate</button>
          <button type="button" style={field} disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </form>}
    </PlatformPanel>
    <PlatformPanel style={{ padding: 16, overflowX: "auto" }}>
      <table style={{ width: "100%", textAlign: "left", borderSpacing: "8px 12px" }}>
        <thead><tr>{["Terminal", "Warehouse", "Customer", "Mode / Revenue code", "Fuel", "Base rate", "Included chassis", "Status", "Notes", ""].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(rate => <tr key={key(rate)}>
          <td>{rate.terminal}</td><td>{siteLabel(rate.terminal, rate.site_code)}</td><td>{rate.customer_code}</td>
          <td>{rate.service_type} / {rate.revenue_code}</td><td>{fuelModes[rate.fuel_mode]}</td><td>{usd(rate.base_rate)}</td>
          <td>{rate.included_chassis_days} days × {usd(rate.chassis_daily_rate)}</td><td>{rate.active ? "Active" : "Inactive"}</td><td>{rate.notes || "—"}</td>
          <td><button type="button" style={field} disabled={busy} onClick={() => edit(rate)}>Edit</button></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p>{loading ? "Loading rates…" : "No rates in this location and mode."}</p>}
    </PlatformPanel>
  </main>;
}
