"use client";

import { useEffect, useState } from "react";
import styles from "./rates.module.css";

type Rate = {
  customer_code: string;
  pickup_city: string;
  pickup_state: string;
  delivery_city: string;
  delivery_state: string;
  delivery_code: string | null;
  pickup_codes: string[];
  base_rate: number;
  order_type: string;
  fuel_code: string | null;
  contract_miles: number | null;
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function laneKey(rate: Rate) {
  return JSON.stringify([rate.customer_code, rate.pickup_city, rate.pickup_state, rate.delivery_city, rate.delivery_state]);
}

export default function TransitRates() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{key: string; code: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function saveCode(rate: Rate, code: string) {
    setSaving(true);
    setSaveError("");
    try {
      const {pickup_city, pickup_state, delivery_city, delivery_state} = rate;
      const response = await fetch("/api/warehouse/transit-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({pickup_city, pickup_state, delivery_city, delivery_state, delivery_code: code}),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not save the delivery code.");
      setRates(previous => previous.map(row => laneKey(row) === laneKey(rate)
        ? { ...row, delivery_code: result.delivery_code } : row));
      setEditing(null);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save the delivery code.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const request = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/warehouse/transit-rates", { signal: request.signal });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Could not load transit rates.");
        setRates(result.rates);
      } catch (reason) {
        if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load transit rates.");
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => request.abort();
  }, []);

  const visible = rates.filter(rate => [rate.customer_code, rate.pickup_city, rate.pickup_state,
    rate.delivery_city, rate.delivery_state, rate.delivery_code, rate.order_type, ...rate.pickup_codes].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

  if (loading) return <p role="status">Loading transit rates…</p>;
  if (error) return <p role="alert">{error}</p>;

  return <>
    <div className={styles.filters}>
      <label>Search transit rates<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p role="status">{visible.length} of {rates.length} lanes</p>
    </div>
    {saveError && <p role="alert">{saveError}</p>}
    <datalist id="transit-delivery-codes">
      {[...new Set(rates.filter(rate => rate.customer_code === "ALLECOTN").flatMap(rate => rate.delivery_code ? [rate.delivery_code] : []))]
        .sort().map(code => <option key={code} value={code} />)}
    </datalist>
    <div className={styles.gridScroll} role="region" aria-label="Inbound transit rates" tabIndex={0}>
      <table className={styles.grid}>
        <thead><tr>{["Customer", "Pickup", "Pickup codes", "Delivery", "Delivery code", "Base rate", "Order type", "Fuel", "Contract miles"]
          .map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(rate => <tr key={laneKey(rate)}>
          <td>{rate.customer_code}</td>
          <td>{rate.pickup_city}, {rate.pickup_state}</td>
          <td>{rate.pickup_codes.join(", ") || "—"}</td>
          <td>{rate.delivery_city}, {rate.delivery_state}</td>
          <td>{editing?.key === laneKey(rate) ? (
            <form onSubmit={event => { event.preventDefault(); void saveCode(rate, editing.code); }}>
              <input aria-label="McLeod delivery code" list="transit-delivery-codes" value={editing.code}
                maxLength={30} required disabled={saving}
                onChange={event => setEditing({key: laneKey(rate), code: event.target.value})} />
              <button type="submit" disabled={saving}>Save</button>
              <button type="button" disabled={saving} onClick={() => { setEditing(null); setSaveError(""); }}>Cancel</button>
            </form>
          ) : <>
            {rate.delivery_code ?? "—"} {rate.customer_code === "ALLECOTN" &&
              <button type="button" disabled={saving} onClick={() => { setSaveError(""); setEditing({key: laneKey(rate), code: rate.delivery_code ?? ""}); }}>Edit code</button>}
          </>}</td>
          <td>{currency.format(rate.base_rate)}</td>
          <td>{rate.order_type}</td>
          <td>{rate.fuel_code ?? "Included"}</td>
          <td>{rate.contract_miles ?? "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}
