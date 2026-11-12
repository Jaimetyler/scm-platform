"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import styles from "./rates.module.css";
import { useWarehouseWorkspace } from "@/components/warehouse/WarehouseWorkspace";
import { CHECKIN_SITES, TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import { fuelModes, rateColumns, rateModes, type ServiceRate } from "@/lib/dray/service-rates";


const blank = { terminal: "DAL", site_code: "", customer_code: "", revenue_code: "DDRAY", service_type: "drayage",
  fuel_mode: "all_in", base_rate: "", included_chassis_days: "0", chassis_daily_rate: "0", active: "true", notes: "" };
type Draft = typeof blank;
const key = (rate: ServiceRate) => [rate.terminal, rate.site_code, rate.customer_code, rate.revenue_code, rate.service_type].join("|");
const usd = (amount: number | null) => amount == null ? "—" : Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
const siteLabel = (terminal: string, code: string) => code ? CHECKIN_SITES.find(site => site.terminal === terminal && site.siteCode === code)?.siteName ?? code : "Terminal default";

export default function WarehouseRates() {
  const { location } = useWarehouseWorkspace();
  const [rates, setRates] = useState<ServiceRate[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
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
    && (!mode || rate.service_type === mode)
    && [rate.customer_code, rate.revenue_code, siteLabel(rate.terminal, rate.site_code)].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const change = (name: keyof Draft, value: string) => setDraft(current => current && { ...current, [name]: value });
  return <main className={styles.page}>
    <PlatformPageHeader title="Rates" subtitle="Customer pricing and allowances used to review order charges."
      actions={<><button type="button" className={styles.button} onClick={() => { setError(""); setShowImport(true); }}>Import rates</button>
        <button type="button" className={styles.primary} onClick={() => edit()}>Add rate</button></>} />
    <div className={styles.filters}>
      <label>Search rates<input type="search" value={search} placeholder="Customer code or warehouse" onChange={event => setSearch(event.target.value)} /></label>
      <label>Mode<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="">All modes</option>{rateModes.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
    </div>
    {message && <p role="status">{message}</p>}
    {error && !dialogOpen && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.cards}>
      {visible.map(rate => <article className={styles.card} key={key(rate)}>
        <header><div><h2>{rate.customer_code}</h2>
          <p>{TERMINAL_NAMES[rate.terminal as keyof typeof TERMINAL_NAMES]} · {siteLabel(rate.terminal, rate.site_code)} · {rate.service_type} / {rate.revenue_code}</p></div>
          <button type="button" className={styles.button} onClick={() => edit(rate)} aria-label={`Edit ${rate.customer_code} rate`}>Edit</button>
        </header>
        {!rate.active && <p className={styles.error}>Inactive</p>}
        <dl className={styles.terms}>
          <div><dt>Base rate</dt><dd>{rate.base_rate == null ? "Contract base needed" : usd(rate.base_rate)}</dd></div>
          <div><dt>Fuel</dt><dd>{fuelModes[rate.fuel_mode]}</dd></div>
          <div><dt>Included chassis</dt><dd>{rate.included_chassis_days ? `${rate.included_chassis_days} ${rate.included_chassis_days === 1 ? "day" : "days"} at ${usd(rate.chassis_daily_rate)}/day` : "None"}</dd></div>
        </dl>
        {rate.notes && <p className={styles.notes}>{rate.notes}</p>}
      </article>)}
    </div>
    {!visible.length && <p className={styles.empty}>{loading ? "Loading rates…" : "No rates match these filters."}</p>}

    <dialog ref={dialog} className={styles.dialog} aria-labelledby="rate-dialog-title"
      onCancel={event => { event.preventDefault(); if (!busy) closeDialog(); }}>
      <h2 id="rate-dialog-title">{showImport ? "Import rates" : editing ? "Edit rate" : "Add rate"}</h2>
      {error && dialogOpen && <p role="alert" className={styles.error}>{error}</p>}
      {showImport && <form onSubmit={event => void save(event, true)}>
        <p>Upload a CSV or XLSX. Leave site code blank for a terminal default. Matching rates are updated.</p>
        <code>{rateColumns.join(",")}</code>
        <p>Modes: {rateModes.join(", ")}. Fuel values: FSC, FLAT, or All in. Enter the contracted base for every row.</p>
        <label className={styles.label}>Rate file<input type="file" accept=".csv,.xlsx" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <footer><button type="button" className={styles.button} disabled={busy} onClick={closeDialog}>Cancel</button>
          <button className={styles.primary} disabled={busy || !file}>Import and save</button></footer>
      </form>}
      {draft && <form onSubmit={event => void save(event)}>
        <fieldset className={styles.fields} disabled={busy}>
          <legend>Applies to</legend>
          <label>Terminal<select disabled={editing} value={draft.terminal}
            onChange={event => setDraft({ ...draft, terminal: event.target.value, site_code: "" })}>
            {Object.entries(TERMINAL_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select></label>
          <label>Warehouse<select disabled={editing} value={draft.site_code} onChange={event => change("site_code", event.target.value)}>
            <option value="">Terminal default</option>
            {CHECKIN_SITES.filter(site => site.terminal === draft.terminal).map(site => <option key={site.siteCode} value={site.siteCode}>{site.siteName}</option>)}
          </select></label>
          <label>McLeod customer code<input required disabled={editing} maxLength={30} value={draft.customer_code} onChange={event => change("customer_code", event.target.value)} /></label>
          <label>Mode<select disabled={editing} value={draft.service_type} onChange={event => change("service_type", event.target.value)}>
            {rateModes.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label>Revenue code<input required disabled={editing} maxLength={30} value={draft.revenue_code} onChange={event => change("revenue_code", event.target.value)} /></label>
        </fieldset>
        <fieldset className={styles.fields} disabled={busy}>
          <legend>Pricing terms</legend>
          <label>Fuel treatment<select value={draft.fuel_mode} onChange={event => change("fuel_mode", event.target.value)}>
            {Object.entries(fuelModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Contract base per order<input required type="number" min="0" step=".01" value={draft.base_rate} onChange={event => change("base_rate", event.target.value)} /></label>
          <label>Included chassis days<input required type="number" min="0" step="1" value={draft.included_chassis_days} onChange={event => change("included_chassis_days", event.target.value)} /></label>
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
