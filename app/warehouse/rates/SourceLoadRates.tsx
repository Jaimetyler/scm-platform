"use client";

import { useEffect, useState } from "react";
import styles from "./rates.module.css";

type Rate = { city: string; state: string; port: number; ramp: number };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function SourceLoadRates() {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/warehouse/rates?category=source-loads", { signal: controller.signal });
        if (!response.ok) throw Error("Could not load Source Load rates.");
        const data = await response.json();
        setRates(data.rates);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return <section aria-labelledby="source-load-rates">
    <h2 id="source-load-rates">Toyo Cotton · Houston</h2>
    {error ? <p role="alert">Could not load Source Load rates.</p> : !rates ? <p role="status">Loading rates…</p> :
      <div style={{ overflowX: "auto" }}>
        <table className={styles.table}>
          <thead><tr><th>Pickup city</th><th>State</th><th>Port base rate</th><th>Ramp base rate</th></tr></thead>
          <tbody>{rates.map(rate => <tr key={rate.city}>
            <td>{rate.city}</td><td>{rate.state}</td><td>{currency.format(rate.port)}</td><td>{currency.format(rate.ramp)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
