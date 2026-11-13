"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { COTTON_DELIVERY_LOCATIONS } from "@/lib/bunge/destinations";
import { transitColumns, type TransitRate, type TransitRateSide } from "@/lib/dray/transit-rates";
import RateImportGuide from "./RateImportGuide";
import styles from "./rates.module.css";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const template = `data:text/csv;charset=utf-8,${encodeURIComponent(transitColumns.join(",") + "\r\n")}`;

export default function TransitRateGrid({ side }: { side: TransitRateSide }) {
  const endpoint = `/api/warehouse/transit-rates?side=${side}`;
  const [rates, setRates] = useState<TransitRate[]>([]);
  const [search, setSearch] = useState("");
  const [delivery, setDelivery] = useState("");
  const [editing, setEditing] = useState<TransitRate | null>(null);
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        if (!controller.signal.aborted) setRates(result.rates);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load rates.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint]);

  function open(rate: TransitRate | null, upload: boolean) {
    setEditing(rate);
    setImporting(upload);
    setVersion(current => current + 1);
    setError("");
    setMessage("");
    dialog.current?.showModal();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, importing ? { method: "POST", body: form } : {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing?.id, version: editing?.updated_at, rate: Object.fromEntries(form) }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      const saved: TransitRate[] = result.rates;
      const savedIds = new Set(saved.map(rate => rate.id));
      setRates(current => [...current.filter(rate => !savedIds.has(rate.id)), ...saved]);
      setMessage(`${saved.length} rate${saved.length === 1 ? "" : "s"} saved.`);
      dialog.current?.close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save rates.");
    } finally { setBusy(false); }
  }

  const term = search.trim().toUpperCase();
  const visible = rates.filter(rate => (!delivery || rate.delivery_code === delivery) &&
    [rate.account_code, rate.account_name, rate.pickup_city, rate.pickup_state, rate.delivery_code].some(value => value.toUpperCase().includes(term)))
    .sort((a, b) => a.account_code.localeCompare(b.account_code) || a.pickup_city.localeCompare(b.pickup_city) || a.pickup_state.localeCompare(b.pickup_state) || a.delivery_code.localeCompare(b.delivery_code));

  return <section className={styles.page} aria-label="Transit Inbound Rates">
    <div className={styles.filters} style={{ alignItems: "end" }}>
      <label>Search rates<input type="search" placeholder="Code, name, or pickup city" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>Delivery<select value={delivery} onChange={event => setDelivery(event.target.value)}>
        <option value="">All deliveries</option>
        {COTTON_DELIVERY_LOCATIONS.map(location => <option key={location.code} value={location.code}>{location.code}</option>)}
      </select></label>
      <button type="button" className={styles.primary} disabled={loading} onClick={() => open(null, false)}>Add rate</button>
      <button type="button" className={styles.button} disabled={loading} onClick={() => open(null, true)}>Import rates</button>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.gridScroll} role="region" aria-label="Transit rate grid" tabIndex={0}>
      <table className={styles.grid}>
        <thead><tr>{[`McLeod ${side} code`, "Name", "Pickup city", "State", "Delivery", "Flat rate per load", "Actions"].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(rate => <tr key={rate.id}>
          <th scope="row">{rate.account_code}</th><td>{rate.account_name || "—"}</td><td>{rate.pickup_city}</td><td>{rate.pickup_state}</td>
          <td>{rate.delivery_code}</td><td className={styles.amount}>{usd.format(rate.flat_cents / 100)}</td>
          <td><button type="button" className={styles.button} onClick={() => open(rate, false)}>Edit</button></td>
        </tr>)}
        {!visible.length && <tr><td colSpan={7}>{loading ? "Loading transit rates…" : "No transit rates match."}</td></tr>}</tbody>
      </table>
    </div>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="transit-rate-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="transit-rate-title">{importing ? "Import transit rates" : editing ? "Edit transit rate" : "Add transit rate"}</h2>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <form key={version} onSubmit={save}>
        {importing ? <>
          <p>Use the first sheet of a CSV or XLSX, up to 500 rows and 2 MB. Imports add new rates. Use Edit to change an existing route rate.</p>
          <a className={`${styles.button} ${styles.download}`} href={template} download={`inbound-transit-${side}-rates.csv`}>Download CSV template</a>
          <RateImportGuide columns={[
            ["account_code", "Yes", `McLeod ${side} code.`],
            ["account_name", "No", "Display name."],
            ["pickup_city", "Yes", "City shared by the pickup locations this rate covers."],
            ["pickup_state", "Yes", "Two-letter state code, such as TX."],
            ["delivery_code", "Yes", "McLeod delivery location code used in the inbound importer, such as SUPPBAT1."],
            ["flat_rate", "Yes", "Dollars per load, such as 850.00."],
          ]} />
          <label className={styles.label}>Rate file<input name="file" type="file" accept=".csv,.xlsx" required disabled={busy} /></label>
        </> : <fieldset className={styles.fields} disabled={busy}>
          <label>McLeod {side} code<input name="account_code" required maxLength={30} defaultValue={editing?.account_code} /></label>
          <label>Name<input name="account_name" maxLength={100} defaultValue={editing?.account_name} /></label>
          <label>Pickup city<input name="pickup_city" required maxLength={100} defaultValue={editing?.pickup_city} /></label>
          <label>Pickup state<input name="pickup_state" required maxLength={2} pattern="[A-Za-z]{2}" defaultValue={editing?.pickup_state} /></label>
          <label>Delivery<select name="delivery_code" required defaultValue={editing?.delivery_code ?? ""}>
            <option value="">Choose delivery</option>
            {COTTON_DELIVERY_LOCATIONS.map(location => <option key={location.code} value={location.code}>{location.code} · {location.label}</option>)}
          </select></label>
          <label>Flat rate per load ($)<input name="flat_rate" type="number" min={0} max={999999.99} step=".01" required defaultValue={editing ? (editing.flat_cents / 100).toFixed(2) : undefined} /></label>
        </fieldset>}
        <footer><button type="button" className={styles.button} disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
          <button className={styles.primary} disabled={busy}>{busy ? "Saving…" : importing ? "Import rates" : "Save rate"}</button></footer>
      </form>
    </dialog>
  </section>;
}
