"use client";

import { useRef, useState, type FormEvent } from "react";
import { rateItems, type CarrierRate } from "@/lib/warehouse/outbound/carrier-rates";
import { CarrierRateForm } from "../outbound/[terminal]/[siteCode]/[id]/CarrierRates";
import styles from "../rates/rates.module.css";
import { CHECKIN_SITES, TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import type { WarehouseLocation } from "@/lib/warehouse/navigation";
import RateImportGuide from "../rates/RateImportGuide";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const template = ["carrierId,carrierName,warehouse,lane," + rateItems.map(item => item.key).join(","), ""].join("\n");

type YardRate = CarrierRate & { terminal: string; site_code: string };
const yards = CHECKIN_SITES.filter(site => site.materials.includes("cotton"));

export default function CarrierRateEditor({ initialRates, location }: { initialRates: YardRate[]; location: WarehouseLocation }) {
  const [terminal, setTerminal] = useState<string>(location.terminal);
  const [delivery, setDelivery] = useState("");
  const [yardCode, setYardCode] = useState(location.siteCode);
  const yard = yards.find(site => site.siteCode === yardCode);
  const scopedYard = yards.find(site => site.terminal === location.terminal && site.siteCode === location.siteCode);
  const importEndpoint = scopedYard ? `/api/warehouse/carrier-rates?terminal=${scopedYard.terminal}&siteCode=${scopedYard.siteCode}` : "/api/warehouse/carrier-rates";
  const [rates, setRates] = useState(initialRates);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState("");
  const [copying, setCopying] = useState<YardRate | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editor = useRef<HTMLDialogElement>(null);
  const importer = useRef<HTMLDialogElement>(null);
  const query = search.trim().toLowerCase();
  const terminalRates = rates.filter(rate => terminal === "all" || rate.terminal === terminal);
  const deliveries = [...new Set(terminalRates.map(rate => rate.lane))].sort();
  const visible = terminalRates.filter(rate => (!delivery || rate.lane === delivery) && [rate.carrier_id, rate.carrier_name, rate.lane].some(value => value.toLowerCase().includes(query)))
    .sort((a, b) => a.carrier_name.localeCompare(b.carrier_name) || a.lane.localeCompare(b.lane));

  function edit(id: string, source: YardRate | null = null) {
    setEditing(id);
    setCopying(source);
    setYardCode(source?.site_code ?? rates.find(rate => rate.id === id)?.site_code ?? scopedYard?.siteCode ?? "");
    setFormVersion(current => current + 1);
    setMessage("");
    editor.current?.showModal();
  }

  async function importRates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(importEndpoint, { method: "POST", body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not import carrier rates.");
      setRates(current => [...current, ...result.rates]);
      setMessage(`Imported ${result.count} carrier rates.`);
      importer.current?.close();
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import carrier rates.");
    } finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <div className={styles.filters} style={{ alignItems: "end" }}>
      <label>Search local dray rates<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Carrier, code, or delivery" /></label>
      <label>Terminal<select value={terminal} onChange={event => { setTerminal(event.target.value); setDelivery(""); }}>
        <option value="all">All terminals</option>
        {Object.entries(TERMINAL_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select></label>
      <label>Delivery<select value={delivery} onChange={event => setDelivery(event.target.value)}>
        <option value="">All deliveries</option>
        {deliveries.map(code => <option key={code}>{code}</option>)}
      </select></label>
      <button className={styles.primary} onClick={() => edit("")}>Add local dray rate</button>
      <button className={styles.button} onClick={() => { setError(""); importer.current?.showModal(); }}>Import rates</button>
    </div>
    {message && <p role="status">{message}</p>}
    <div className={styles.gridScroll} tabIndex={0} role="region" aria-label="Local dray rates grid">
      <table className={styles.grid}>
        <thead><tr><th scope="col">Carrier</th><th scope="col">McLeod carrier code</th><th scope="col">Warehouse</th><th scope="col">Delivery</th>
          {rateItems.map(item => <th scope="col" key={item.key}>{item.key === "chassisDays" ? "Chassis per day" : item.label}</th>)}<th scope="col">Actions</th></tr></thead>
        <tbody>{visible.map(rate => <tr key={rate.id}><th scope="row">{rate.carrier_name}</th><td>{rate.carrier_id}</td><td>{yards.find(site => site.siteCode === rate.site_code && site.terminal === rate.terminal)?.displayCode ?? rate.site_code}</td><td>{rate.lane}</td>
          {rateItems.map(item => <td key={item.key} className={styles.amount}>{money.format(rate.rates[item.key].pay / 100)}</td>)}
          <td><select aria-label={`Actions for ${rate.carrier_name}, ${rate.lane}`} value="" onChange={event => {
            if (event.target.value === "edit") edit(rate.id);
            if (event.target.value === "copy") edit("", rate);
          }}>
            <option value="">Actions</option>
            <option value="edit">Edit rate</option>
            <option value="copy">Copy rate</option>
          </select></td></tr>)}
          {!visible.length && <tr><td colSpan={9}>{query ? "No matching carrier rates." : "No rates match these filters."}</td></tr>}</tbody>
      </table>
    </div>
    <dialog ref={editor} className={`${styles.dialog} carrier-rate-editor-dialog`} aria-labelledby="carrier-rate-editor-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="carrier-rate-editor-title">{editing ? "Edit local dray rate" : copying ? "Copy local dray rate" : "Add local dray rate"}</h2>
      {copying && <p>Copied from {copying.carrier_name} · {copying.lane}. Choose the warehouse and update the carrier or delivery as needed before saving.</p>}
      <label className={styles.label}>Warehouse<select value={yardCode} disabled={Boolean(editing) || busy} onChange={event => setYardCode(event.target.value)}>
        <option value="">Choose a warehouse</option>
        {yards.map(site => <option key={site.siteCode} value={site.siteCode}>{site.siteName}</option>)}
      </select></label>
      {yard && <CarrierRateForm key={`${formVersion}:${yardCode}`} initialId={editing} copyFrom={copying ?? undefined} rates={rates}
        endpoint={`/api/warehouse/carrier-rates?terminal=${yard.terminal}&siteCode=${yard.siteCode}`} onSaving={setBusy}
        onSaved={rate => {
          setRates(current => [...current.filter(item => item.id !== rate.id), { ...rate, terminal: yard.terminal, site_code: yard.siteCode }]);
          setMessage("Carrier rate saved.");
          editor.current?.close();
        }} />}
      <footer><button className={styles.button} disabled={busy} onClick={() => editor.current?.close()}>Close</button></footer>
    </dialog>
    <dialog ref={importer} className={styles.dialog} aria-labelledby="carrier-import-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="carrier-import-title">Import local dray rates</h2>
      <p>Use the template headers on the first sheet of a CSV or XLSX up to 2 MB, with 1–500 rate rows. Enter a warehouse on each row when importing across yards. Enter carrier pay in dollars without currency symbols or commas. Use 0 for charges that do not apply.</p>
      <p>Imports use the warehouse number on each row. A duplicate carrier code and delivery for the same warehouse rejects the entire import. Use Edit in the grid to change existing rates.</p>
      <a className={`${styles.button} ${styles.download}`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="carrier-rate-import-template.csv">Download CSV template</a>
      <RateImportGuide columns={[
        ["carrierId", "Yes", "Use the 8-character McLeod carrier code, for example SCMIRIGA."],
        ["carrierName", "Yes", "Carrier name as it should appear on the rate card."],
        ["warehouse", scopedYard ? "No" : "Yes", "Warehouse number, such as 2119 or 5300. Blank uses the selected warehouse when one is selected."],
        ["lane", "Yes", "Delivery location. Use the McLeod location code, for example BNSFHATX."],
        ["base", "Yes", "Base drayage pay for one load."],
        ["chassisDays", "Yes", "Chassis pay per day in dollars. This column takes the daily rate."],
        ["chassisSplits", "Yes", "Pay per chassis split (CS)."],
        ["stopoffs", "Yes", "Pay per extra stop."],
      ]} />
      <form onSubmit={importRates}>
        <label className={styles.label}>Rate file<input name="file" type="file" accept=".csv,.xlsx" required disabled={busy} /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <footer><button type="button" className={styles.button} disabled={busy} onClick={() => importer.current?.close()}>Cancel</button>
          <button className={styles.primary} disabled={busy}>{busy ? "Importing…" : "Import rates"}</button></footer>
      </form>
    </dialog>
  </div>;
}
