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
    <div className={styles.gridScroll} role="region" aria-label="Inbound transit rates" tabIndex={0}>
      <table className={styles.grid}>
        <thead><tr>{["Customer", "Pickup", "Pickup codes", "Delivery", "Delivery code", "Base rate", "Order type", "Fuel", "Contract miles"]
          .map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(rate => <tr key={laneKey(rate)}>
          <td>{rate.customer_code}</td>
          <td>{rate.pickup_city}, {rate.pickup_state}</td>
          <td>{rate.pickup_codes.join(", ") || "—"}</td>
          <td>{rate.delivery_city}, {rate.delivery_state}</td>
          <td>{rate.delivery_code ?? "—"}</td>
          <td>{currency.format(rate.base_rate)}</td>
          <td>{rate.order_type === "UNCONFIRMED" ? "—" : rate.order_type}</td>
          <td>{rate.fuel_code ?? (rate.order_type === "UNCONFIRMED" ? "—" : "Included")}</td>
          <td>{rate.contract_miles ?? "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}
