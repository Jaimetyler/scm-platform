"use client";

import { useEffect, useState } from "react";

type RoutingRow = { delivery_code: string; miles: number; order_count: number };
type ContractRow = { customer_code: string; pickup_city: string; pickup_state: string; delivery_code: string; miles: number; locked_order_count: number };

export default function MileageEvidence({ locationId }: { locationId?: string }) {
  const [rows, setRows] = useState<(RoutingRow | ContractRow)[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const endpoint = locationId ? `/api/cotton-locations/mileage?location_id=${encodeURIComponent(locationId)}` : "/api/warehouse/contract-miles";
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (!controller.signal.aborted) setRows(result.rows);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load mileage.");
    });
    return () => controller.abort();
  }, [locationId]);

  return <section aria-label={locationId ? "Routing miles" : "Contract miles"}>
    <h3>{locationId ? "Routing miles" : "Contract miles"}</h3>
    <p>{locationId ? "Historical McLeod billed miles by receiving yard." : "Based on locked McLeod billed miles. Single-order lanes are provisional."}</p>
    {error ? <p role="alert">{error}</p> : !rows ? <p>Loading mileage…</p> : !rows.length ? <p>No mileage saved.</p> :
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}>
        <thead><tr>{!locationId && <><th scope="col">Customer</th><th scope="col">Pickup city / state</th></>}
          <th scope="col">Delivery</th><th scope="col">Miles</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{rows.map(row => {
          const contract = "customer_code" in row ? row : null;
          const count = "order_count" in row ? row.order_count : row.locked_order_count;
          return <tr key={JSON.stringify([contract?.customer_code, contract?.pickup_city, contract?.pickup_state, row.delivery_code])}>
            {contract && <><td>{contract.customer_code}</td><td>{contract.pickup_city}, {contract.pickup_state}</td></>}
            <td>{row.delivery_code}</td><td>{row.miles}</td><td>{count} {contract ? "locked " : ""}{count === 1 ? "order · Provisional" : "orders"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
  </section>;
}
