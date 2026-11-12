"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import styles from "./rates.module.css";
import { useWarehouseWorkspace } from "@/components/warehouse/WarehouseWorkspace";
import { CHECKIN_SITES, TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import { bookingReturnLocationLabel } from "@/lib/warehouse/outbound/return-location";
import { fuelModes, rateColumns, rateModes, type ServiceRate } from "@/lib/dray/service-rates";


const blank = { terminal: "DAL", site_code: "", customer_code: "", revenue_code: "DDRAY", service_type: "drayage",
  return_location: "", fuel_mode: "all_in", base_rate: "", included_chassis_days: "0", chassis_daily_rate: "0", chassis_split_rate: "", stopoff_rate: "", active: "true", notes: "" };
type Draft = typeof blank;
const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(rateColumns.join(",") + "\r\n")}`;
type SavedRate = ServiceRate & { rate_code: number };
const usd = (amount: number | null) => amount == null ? "—" : Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
const siteLabel = (terminal: string, code: string) => code ? CHECKIN_SITES.find(site => site.terminal === terminal && site.siteCode === code)?.siteName ?? code : "Terminal default";

export default function WarehouseRates() {
  const { location } = useWarehouseWorkspace();
  const [rates, setRates] = useState<SavedRate[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<number | undefined>();
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dialog = useRef<HTMLDialogElement>(null);
  const dialogOpen = Boolean(draft || showImport);
  useEffect(() => {
    const element = dialog.current;
    if (dialogOpen && !element?.open) element?.showModal();
    else if (!dialogOpen && element?.open) element.close();
  }, [dialogOpen]);
  function closeDialog() {
    setDraft(null); setShowImport(false); setFile(null); setError("");
  }

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

  function edit(rate?: SavedRate) {
    setEditing(rate?.rate_code); setError(""); setMessage("");
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
        ...(importing ? { body: upload } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates: [draft], rateCode: editing }) }) });
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
    && (!mode || rate.service_type === mode)
    && [rate.customer_code, rate.revenue_code, `R-${rate.rate_code}`, rate.return_location, bookingReturnLocationLabel(rate.return_location), siteLabel(rate.terminal, rate.site_code)].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const change = (name: keyof Draft, value: string) => setDraft(current => current && { ...current, [name]: value });
  return <main className={styles.page}>
    <PlatformPageHeader title="Rates" subtitle="Customer pricing and allowances used to review order charges."
      actions={<><button type="button" className={styles.button} onClick={() => { setError(""); setShowImport(true); }}>Import rates</button>
        <button type="button" className={styles.primary} onClick={() => edit()}>Add rate</button></>} />
    <div className={styles.filters}>
      <label>Search rates<input type="search" value={search} placeholder="Rate code, customer, or location" onChange={event => setSearch(event.target.value)} /></label>
      <label>Mode<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="">All modes</option>{rateModes.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
    </div>
    {message && <p role="status">{message}</p>}
    {error && !dialogOpen && <p role="alert" className={styles.error}>{error}</p>}
    {visible.length > 0 && <div className={styles.gridScroll} role="region" aria-label="Customer rates grid" tabIndex={0}>
      <table className={styles.grid} aria-label="Customer rates">
        <thead><tr>{["Rate code", "Customer", "Warehouse", "Return location", "Mode / code", "Contract base", "Fuel", "Included chassis", "Notes", "Actions"].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(rate => <tr key={rate.rate_code}>
          <th scope="row">R-{rate.rate_code}</th>
          <td>{rate.customer_code}{!rate.active && <small className={styles.inactive}>Inactive</small>}</td>
          <td>{rate.site_code ? siteLabel(rate.terminal, rate.site_code) : <>{TERMINAL_NAMES[rate.terminal as keyof typeof TERMINAL_NAMES]}<small>Terminal default</small></>}</td>
          <td>{rate.return_location ? bookingReturnLocationLabel(rate.return_location) : "Any return"}</td>
          <td className={styles.mode}>{rate.service_type}<small>{rate.revenue_code}</small></td>
          <td className={styles.amount}>{rate.base_rate == null ? <small>Contract base needed</small> : usd(rate.base_rate)}</td>
          <td>{fuelModes[rate.fuel_mode]}</td>
          <td className={styles.amount}>{rate.included_chassis_days ? `${rate.included_chassis_days} ${rate.included_chassis_days === 1 ? "day" : "days"}` : "None"}
            {rate.chassis_daily_rate > 0 && <small>{usd(rate.chassis_daily_rate)}/day</small>}
            {rate.chassis_split_rate != null && <small>Split {usd(rate.chassis_split_rate)}</small>}
            {rate.stopoff_rate != null && <small>Stopoff {usd(rate.stopoff_rate)}</small>}</td>
          <td className={styles.gridNotes}>{rate.notes || "—"}</td>
          <td><button type="button" className={styles.button} onClick={() => edit(rate)} aria-label={`Edit ${rate.customer_code} rate`}>Edit</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
    {!visible.length && <p className={styles.empty}>{loading ? "Loading rates…" : "No rates match these filters."}</p>}

    <dialog ref={dialog} className={styles.dialog} aria-labelledby="rate-dialog-title"
      onCancel={event => { event.preventDefault(); if (!busy) closeDialog(); }}>
      <h2 id="rate-dialog-title">{showImport ? "Import rates" : editing ? `Edit rate R-${editing}` : "Add rate"}</h2>
      {error && dialogOpen && <p role="alert" className={styles.error}>{error}</p>}
      {showImport && <form onSubmit={event => void save(event, true)}>
        <p>Upload a CSV or XLSX. Leave site code blank for a terminal default. Leave return location blank for any return. Matching rates are updated.</p>
        <a className={`${styles.button} ${styles.download}`} href={templateUrl} download="rate-import-template.csv">Download CSV template</a>
        <p>Modes: {rateModes.join(", ")}. Fuel values: FSC, FLAT, or All in. Enter the contracted base for every row.</p>
        <label className={styles.label}>Rate file<input type="file" accept=".csv,.xlsx" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <footer><button type="button" className={styles.button} disabled={busy} onClick={closeDialog}>Cancel</button>
          <button className={styles.primary} disabled={busy || !file}>Import and save</button></footer>
      </form>}
      {draft && <form onSubmit={event => void save(event)}>
        <fieldset className={styles.fields} disabled={busy}>
          <legend>Applies to</legend>
          <label>Terminal<select value={draft.terminal}
            onChange={event => setDraft({ ...draft, terminal: event.target.value, site_code: "" })}>
            {Object.entries(TERMINAL_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select></label>
          <label>Warehouse<select value={draft.site_code} onChange={event => change("site_code", event.target.value)}>
            <option value="">Terminal default</option>
            {CHECKIN_SITES.filter(site => site.terminal === draft.terminal).map(site => <option key={site.siteCode} value={site.siteCode}>{site.siteName}</option>)}
          </select></label>
          <label>McLeod customer code<input required maxLength={30} value={draft.customer_code} onChange={event => change("customer_code", event.target.value)} /></label>
          <label>Mode<select value={draft.service_type} onChange={event => change("service_type", event.target.value)}>
            {rateModes.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label>Return location<input maxLength={300} placeholder="Any return" value={draft.return_location} onChange={event => change("return_location", event.target.value)} /></label>
          <label>Revenue code<input required maxLength={30} value={draft.revenue_code} onChange={event => change("revenue_code", event.target.value)} /></label>
        </fieldset>
        <fieldset className={styles.fields} disabled={busy}>
          <legend>Pricing terms</legend>
          <label>Fuel treatment<select value={draft.fuel_mode} onChange={event => change("fuel_mode", event.target.value)}>
            {Object.entries(fuelModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Contract base per order<input required type="number" min="0" step=".01" value={draft.base_rate} onChange={event => change("base_rate", event.target.value)} /></label>
          <label>Included chassis days<input required type="number" min="0" step="1" value={draft.included_chassis_days} onChange={event => change("included_chassis_days", event.target.value)} /></label>
          <label>Chassis split rate<input type="number" min="0" step=".01" placeholder="Not set" value={draft.chassis_split_rate} onChange={event => change("chassis_split_rate", event.target.value)} /></label>
          <label>Stopoff rate<input type="number" min="0" step=".01" placeholder="Not set" value={draft.stopoff_rate} onChange={event => change("stopoff_rate", event.target.value)} /></label>
          <label>Chassis daily rate<input required type="number" min="0" step=".01" value={draft.chassis_daily_rate} onChange={event => change("chassis_daily_rate", event.target.value)} /></label>
          <label className={styles.notesField}>Notes<textarea rows={2} maxLength={1000} value={draft.notes} onChange={event => change("notes", event.target.value)} /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={draft.active === "true"} onChange={event => change("active", String(event.target.checked))} /> Active</label>
        </fieldset>
        <footer><button type="button" className={styles.button} disabled={busy} onClick={closeDialog}>Cancel</button>
          <button className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save rate"}</button></footer>
      </form>}
    </dialog>
  </main>;
}
