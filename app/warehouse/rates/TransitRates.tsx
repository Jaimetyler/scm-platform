"use client";

import { useEffect, useMemo, useState } from "react";
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

const deliveryLabels: Record<string, string> = {
  "SAVANNAH, GA": "Savannah",
  "GARDEN CITY, GA": "Savannah",
  "PORT WENTWORTH, GA": "Savannah",
  "RINCON, GA": "Savannah",
  "BAYTOWN, TX": "Baytown",
  "PASADENA, TX": "Baytown",
  "DALLAS, TX": "Dallas",
  "DESOTO, TX": "Dallas",
  "MEMPHIS, TN": "Memphis",
  "WEST MEMPHIS, AR": "Memphis",
};

function groupTransitRates(rates: Rate[]) {
  const groups = new Map<string, Map<string, { rate: Rate; sources: Set<string> }>>();
  for (const rate of rates) {
    const source = `${rate.delivery_city}, ${rate.delivery_state}`;
    const delivery = deliveryLabels[source.toUpperCase()] ?? source;
    const lane = JSON.stringify([rate.customer_code, rate.pickup_city, rate.pickup_state, delivery]);
    const terms = JSON.stringify([rate.base_rate, rate.order_type, rate.fuel_code, rate.delivery_code, rate.contract_miles]);
    const variants = groups.get(lane) ?? new Map();
    const variant = variants.get(terms) ?? { rate, sources: new Set<string>() };
    variant.sources.add(source);
    variants.set(terms, variant);
    groups.set(lane, variants);
  }
  return [...groups].flatMap(([lane, variants]) => [...variants].map(([terms, { rate, sources }]) => {
    const source = `${rate.delivery_city}, ${rate.delivery_state}`;
    return { key: lane + terms, rate, sources: [...sources], delivery: deliveryLabels[source.toUpperCase()] ?? source,
      hasVariants: variants.size > 1 };
  }));
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

  const grouped = useMemo(() => groupTransitRates(rates), [rates]);
  const visible = grouped.filter(({ rate, delivery, sources }) => [rate.customer_code, rate.pickup_city, rate.pickup_state,
    delivery, ...sources, rate.delivery_code, rate.order_type, ...rate.pickup_codes].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

  if (loading) return <p role="status">Loading transit rates…</p>;
  if (error) return <p role="alert">{error}</p>;

  return <>
    <div className={styles.filters}>
      <label>Search transit rates<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p role="status">{visible.length} of {grouped.length} lanes</p>
    </div>
    <div className={styles.gridScroll} role="region" aria-label="Inbound transit rates" tabIndex={0}>
      <table className={styles.grid}>
        <thead><tr>{["Customer", "Pickup", "Pickup codes", "Delivery", "Delivery code", "Base rate", "Order type", "Fuel", "Contract miles"]
          .map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.map(({ rate, key, delivery, sources, hasVariants }) => <tr key={key}>
          <td>{rate.customer_code}</td>
          <td>{rate.pickup_city}, {rate.pickup_state}</td>
          <td>{rate.pickup_codes.join(", ") || "—"}</td>
          <td>{delivery}{hasVariants && <div><small>{sources.join(" / ")}</small></div>}</td>
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
