"use client";

import { useRef, useState, type FormEvent } from "react";
import { rateItems, type CarrierRate } from "@/lib/warehouse/outbound/carrier-rates";
import { CarrierRateForm } from "../outbound/[terminal]/[siteCode]/[id]/CarrierRates";
import styles from "../rates/rates.module.css";
import RateImportGuide from "../rates/RateImportGuide";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const template = ["carrierId,carrierName,lane," + rateItems.map(item => item.key).join(","), ""].join("\n");

export default function CarrierRateEditor({ initialRates, endpoint }: { initialRates: CarrierRate[]; endpoint: string }) {
  const [rates, setRates] = useState(initialRates);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editor = useRef<HTMLDialogElement>(null);
  const importer = useRef<HTMLDialogElement>(null);
  const query = search.trim().toLowerCase();
  const visible = rates.filter(rate => [rate.carrier_id, rate.carrier_name, rate.lane].some(value => value.toLowerCase().includes(query)))
    .sort((a, b) => a.carrier_name.localeCompare(b.carrier_name) || a.lane.localeCompare(b.lane));

  function edit(id: string) {
    setEditing(id);
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
      const response = await fetch(endpoint, { method: "POST", body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not import carrier rates.");
      setRates(current => [...current, ...result.rates]);
      setMessage(`Imported ${result.rates.length} carrier rates.`);
      importer.current?.close();
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import carrier rates.");
    } finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <div className={styles.filters} style={{ alignItems: "end" }}>
      <label>Search carrier rates<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Carrier, code, or delivery" /></label>
      <button className={styles.primary} onClick={() => edit("")}>Add carrier rate</button>
      <button className={styles.button} onClick={() => { setError(""); importer.current?.showModal(); }}>Import rates</button>
    </div>
    {message && <p role="status">{message}</p>}
    <div className={styles.gridScroll} tabIndex={0} role="region" aria-label="Carrier rates grid">
      <table className={styles.grid}>
        <thead><tr><th scope="col">Carrier</th><th scope="col">McLeod carrier code</th><th scope="col">Delivery</th>
          {rateItems.map(item => <th scope="col" key={item.key}>{item.key === "chassisDays" ? "Chassis per day" : item.label}</th>)}<th scope="col">Actions</th></tr></thead>
        <tbody>{visible.map(rate => <tr key={rate.id}><th scope="row">{rate.carrier_name}</th><td>{rate.carrier_id}</td><td>{rate.lane}</td>
          {rateItems.map(item => <td key={item.key} className={styles.amount}>{money.format(rate.rates[item.key].pay / 100)}</td>)}
          <td><button className={styles.button} aria-label={`Edit ${rate.carrier_name}, ${rate.lane}`} onClick={() => edit(rate.id)}>Edit</button></td></tr>)}
          {!visible.length && <tr><td colSpan={8}>{query ? "No matching carrier rates." : "No carrier rates for this yard yet."}</td></tr>}</tbody>
      </table>
    </div>
    <dialog ref={editor} className={styles.dialog} aria-labelledby="carrier-rate-editor-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="carrier-rate-editor-title">{editing ? "Edit carrier rate" : "Add carrier rate"}</h2>
      <CarrierRateForm key={formVersion} initialId={editing} rates={rates} endpoint={endpoint} onSaving={setBusy}
        onSaved={rate => {
          setRates(current => [...current.filter(item => item.id !== rate.id), rate]);
          setMessage("Carrier rate saved.");
          editor.current?.close();
        }} />
      <footer><button className={styles.button} disabled={busy} onClick={() => editor.current?.close()}>Close</button></footer>
    </dialog>
    <dialog ref={importer} className={styles.dialog} aria-labelledby="carrier-import-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="carrier-import-title">Import carrier rates</h2>
      <p>Use the template headers on the first sheet of a CSV or XLSX up to 2 MB, with 1–500 rate rows. Every field is required. Enter carrier pay in dollars without currency symbols or commas. Use 0 for charges that do not apply.</p>
      <p>Imports add rates to the selected yard. A duplicate carrier code and delivery in the file or at this yard rejects the entire import. Use Edit in the grid to change existing rates.</p>
      <a className={`${styles.button} ${styles.download}`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="carrier-rate-import-template.csv">Download CSV template</a>
      <RateImportGuide columns={[
        ["carrierId", "Yes", "McLeod carrier code, for example ABC123. Use up to 30 letters, numbers, hyphens, or underscores."],
        ["carrierName", "Yes", "Carrier name as it should appear on the rate card."],
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
