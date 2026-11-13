"use client";

import TransitRateGrid from "./TransitRateGrid";
import { useEffect, useRef, useState, type FormEvent } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import styles from "./rates.module.css";
import RateImportGuide from "./RateImportGuide";
import { useWarehouseWorkspace } from "@/components/warehouse/WarehouseWorkspace";
import { CHECKIN_SITES, TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import { bookingReturnLocationLabel } from "@/lib/warehouse/outbound/return-location";
import { fuelModes, rateColumns, type ServiceRate } from "@/lib/dray/service-rates";


const blank = { terminal: "DAL", site_code: "", customer_code: "", revenue_code: "DDRAY", service_type: "drayage",
  return_location: "", fuel_mode: "all_in", base_rate: "", included_chassis_days: "0", chassis_daily_rate: "0", chassis_split_rate: "", stopoff_rate: "", active: "true", notes: "" };
type Draft = typeof blank;
const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(rateColumns.filter(column => column !== "service_type").join(",") + "\r\n")}`;
type SavedRate = ServiceRate & { rate_code: number };
const usd = (amount: number | null) => amount == null ? "—" : Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
const siteLabel = (terminal: string, code: string) => code ? CHECKIN_SITES.find(site => site.terminal === terminal && site.siteCode === code)?.siteName ?? code : "Terminal default";

export default function WarehouseRates() {
  const { location } = useWarehouseWorkspace();
  const [rates, setRates] = useState<SavedRate[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"drayage" | "inbound">("drayage");
  const [terminal, setTerminal] = useState<string | null>(null);
  const [delivery, setDelivery] = useState("");
  const selectedTerminal = terminal ?? location.terminal;
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
      setDraft({ ...blank, terminal: selectedTerminal === "all" ? "DAL" : selectedTerminal,
        site_code: selectedTerminal !== location.terminal || location.siteCode === "all" ? "" : location.siteCode,
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
      const response = await fetch(importing ? "/api/warehouse/rates?category=local-dray" : "/api/warehouse/rates", { method: "POST",
        ...(importing ? { body: upload } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates: [draft], rateCode: editing }) }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not save rates.");
      setDraft(null); setFile(null); setShowImport(false);
      setMessage(`${result.count} rate${result.count === 1 ? "" : "s"} saved.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save rates."); }
    finally { setBusy(false); }
  }

  const terminalRates = rates.filter(rate => rate.service_type === "drayage" &&
    (selectedTerminal === "all" || rate.terminal === selectedTerminal));
  const deliveries = [...new Set(terminalRates.map(rate => rate.return_location).filter(Boolean))].sort();
  const visible = terminalRates.filter(rate => (!delivery || rate.return_location === delivery)
    && [rate.customer_code, rate.revenue_code, `R-${rate.rate_code}`, rate.return_location, bookingReturnLocationLabel(rate.return_location), siteLabel(rate.terminal, rate.site_code)].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const change = (name: keyof Draft, value: string) => setDraft(current => current && { ...current, [name]: value });
  return <main className={`${styles.page} ${styles.customerPage}`}>
    <PlatformPageHeader compact title="Customer Rates" subtitle="Customer pricing and allowances used to review order charges."
      actions={category === "drayage" && <><button type="button" className={styles.button} onClick={() => { setError(""); setShowImport(true); }}>Import rates</button>
        <button type="button" className={styles.primary} onClick={() => edit()}>Add rate</button></>} />
    <nav className="warehouse-main-nav" aria-label="Customer rate categories" style={{ marginBottom: 12 }}>
      <button type="button" className={styles.button} aria-pressed={category === "drayage"} onClick={() => setCategory("drayage")}>Local Dray Rates</button>
      <button type="button" className={styles.button} aria-pressed={category === "inbound"} onClick={() => setCategory("inbound")}>Transit Inbound Rates</button>
    </nav>
    {category === "inbound" ? <TransitRateGrid side="customer" /> : <>
    <div className={styles.filters}>
      <label>Search rates<input type="search" value={search} placeholder="Rate code, customer, or location" onChange={event => setSearch(event.target.value)} /></label>
      <label>Terminal<select value={selectedTerminal} onChange={event => { setTerminal(event.target.value); setDelivery(""); }}>
        <option value="all">All terminals</option>
        {Object.entries(TERMINAL_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select></label>
      <label>Delivery<select value={delivery} onChange={event => setDelivery(event.target.value)}>
        <option value="">All deliveries</option>
        {deliveries.map(code => <option key={code} value={code}>{bookingReturnLocationLabel(code)}</option>)}
      </select></label>
    </div>
    {message && <p role="status">{message}</p>}
    {error && !dialogOpen && <p role="alert" className={styles.error}>{error}</p>}
    {visible.length > 0 && <div className={styles.gridScroll} role="region" aria-label="Customer rates grid" tabIndex={0}>
      <table className={`${styles.grid} ${styles.customerGrid}`} aria-label="Customer rates">
        <thead><tr>{["Rate code", "Customer", "Warehouse", "Delivery", "Revenue code", "Contract base", "Fuel", "Min. chassis days", "Chassis per day", "Chassis split", "Stopoff", "Notes", "Actions"].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(rate => <tr key={rate.rate_code}>
          <th scope="row">R-{rate.rate_code}</th>
          <td>{rate.customer_code}{!rate.active && <small className={styles.inactive}>Inactive</small>}</td>
          <td>{rate.site_code ? siteLabel(rate.terminal, rate.site_code) : <>{TERMINAL_NAMES[rate.terminal as keyof typeof TERMINAL_NAMES]}<small>Terminal default</small></>}</td>
          <td>{rate.return_location ? bookingReturnLocationLabel(rate.return_location) : "Any return"}</td>
          <td>{rate.revenue_code}</td>
          <td className={styles.amount}>{rate.base_rate == null ? <small>Contract base needed</small> : usd(rate.base_rate)}</td>
          <td>{fuelModes[rate.fuel_mode]}</td>
          <td className={styles.amount}>{rate.included_chassis_days}</td>
          <td className={styles.amount}>{usd(rate.chassis_daily_rate)}</td>
          <td className={styles.amount}>{usd(rate.chassis_split_rate)}</td>
          <td className={styles.amount}>{usd(rate.stopoff_rate)}</td>
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
        <p>Use the template headers on the first sheet of a CSV or XLSX up to 2 MB, with 1–500 rate rows. Enter dollar amounts as numbers without currency symbols or commas. A matching terminal, site, customer, revenue code, service type, and return location updates the existing rate.</p>
        <a className={`${styles.button} ${styles.download}`} href={templateUrl} download="rate-import-template.csv">Download CSV template</a>
        <RateImportGuide columns={[
          ["terminal", "Yes", "Use DAL, HOU, or SAV."],
          ["site_code", "No", "Use the yard number or site code, such as 2119 or SCMDDETX. Blank sets a terminal-wide default."],
          ["customer_code", "Yes", "McLeod customer ID, such as OLAMRITX."],
          ["revenue_code", "Yes", "McLeod revenue code, such as DDRAY."],
          ["service_type", "No", "Defaults to drayage for this import."],
          ["return_location", "No", "Return ramp or location name or code, such as BNSF Haslet or BNSFHATX. Blank applies to any return location."],
          ["fuel_mode", "Yes", "All in (all_in) includes fuel. FSC (base_plus_fsc) means fuel is separate. FLAT (fuel_for_review) flags fuel for review."],
          ["base_rate", "Yes", "Contracted customer base charge in dollars. For All in, enter the amount including fuel."],
          ["included_chassis_days", "Yes", "Minimum billable chassis days per load, charged separately from the base. Use a whole number, or 0 for no minimum."],
          ["chassis_daily_rate", "Yes", "Customer charge per chassis day, including minimum days. Must be positive when a minimum is set."],
          ["chassis_split_rate", "No", "Customer charge per chassis split. Blank leaves the rate unset."],
          ["stopoff_rate", "No", "Customer charge per extra stop. Blank leaves the rate unset."],
          ["active", "No", "true or false. Blank defaults to true."],
          ["notes", "No", "Internal notes, up to 1,000 characters."],
        ]} />
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
          <label>Return location<input maxLength={300} placeholder="Any return" value={draft.return_location} onChange={event => change("return_location", event.target.value)} /></label>
          <label>Revenue code<input required maxLength={30} value={draft.revenue_code} onChange={event => change("revenue_code", event.target.value)} /></label>
        </fieldset>
        <fieldset className={styles.fields} disabled={busy}>
          <legend>Pricing terms</legend>
          <label>Fuel treatment<select value={draft.fuel_mode} onChange={event => change("fuel_mode", event.target.value)}>
            {Object.entries(fuelModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Contract base per order<input required type="number" min="0" step=".01" value={draft.base_rate} onChange={event => change("base_rate", event.target.value)} /></label>
          <label>Minimum chassis days<input required type="number" min="0" step="1" value={draft.included_chassis_days} onChange={event => change("included_chassis_days", event.target.value)} /></label>
          <label>Chassis split rate<input type="number" min="0" step=".01" placeholder="Not set" value={draft.chassis_split_rate} onChange={event => change("chassis_split_rate", event.target.value)} /></label>
          <label>Stopoff rate<input type="number" min="0" step=".01" placeholder="Not set" value={draft.stopoff_rate} onChange={event => change("stopoff_rate", event.target.value)} /></label>
          <label>Chassis per day<input required type="number" min="0" step=".01" value={draft.chassis_daily_rate} onChange={event => change("chassis_daily_rate", event.target.value)} /></label>
          <label className={styles.notesField}>Notes<textarea rows={2} maxLength={1000} value={draft.notes} onChange={event => change("notes", event.target.value)} /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={draft.active === "true"} onChange={event => change("active", String(event.target.checked))} /> Active</label>
        </fieldset>
        <footer><button type="button" className={styles.button} disabled={busy} onClick={closeDialog}>Cancel</button>
          <button className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save rate"}</button></footer>
      </form>}
    </dialog>
    </>}
  </main>;
}
