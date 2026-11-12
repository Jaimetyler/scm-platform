"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { accessorials, carrierPlanLines, rateItems, type CarrierPlan, type CarrierRate } from "@/lib/warehouse/outbound/carrier-rates";

const dollars = (cents: number) => (cents / 100).toFixed(2);
export type CarrierSelection = { rateId: string; rateVersion: string; quantities: Record<string, string>; basePayOverride: string };

export function CarrierRateManager({ rates, endpoint, onSaved }: {
  rates: CarrierRate[]; endpoint: string; onSaved: (rate: CarrierRate) => void;
}) {
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const rate = rates.find(item => item.id === selected);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amounts = Object.fromEntries(rateItems.map(({ key }) => [key, {
      pay: form.get(`${key}-pay`), bill: form.get(`${key}-bill`),
    }]));
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rate?.id, expectedUpdatedAt: rate?.updated_at, carrierId: form.get("carrier"), carrierName: form.get("name"), lane: form.get("lane"), rates: amounts }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result.rate);
      setSelected(result.rate.id);
      setMessage("Carrier rate saved.");
    } catch (error) {
      setMessage((error as Error).message || "Could not save carrier rate.");
    } finally { setSaving(false); }
  }

  return <details style={{ marginBottom: 16 }}>
    <summary>Manage carrier rates</summary>
    <label>Rate card <select value={selected} disabled={saving} onChange={event => { setSelected(event.target.value); setMessage(""); }}>
      <option value="">Add a carrier rate</option>
      {rates.map(item => <option key={item.id} value={item.id}>{item.carrier_name} ({item.carrier_id}) · {item.lane}</option>)}
    </select></label>
    <form key={rate ? `${rate.id}:${rate.updated_at}` : "new"} onSubmit={submit}>
      <fieldset disabled={saving} style={{ display: "grid", gap: 8, maxWidth: 620 }}>
        <label>McLeod carrier ID <input name="carrier" required maxLength={30} defaultValue={rate?.carrier_id} /></label>
        <label>Carrier name <input name="name" required maxLength={100} defaultValue={rate?.carrier_name} /></label>
        <label>Lane / return location <input name="lane" required maxLength={100} defaultValue={rate?.lane} /></label>
        <table><thead><tr><th scope="col">Charge</th><th scope="col">Carrier pay ($)</th><th scope="col">Customer bill ($)</th></tr></thead>
          <tbody>{rateItems.map(({ key, label, code }) => <tr key={key}>
            <th scope="row">{label}{code && ` (${code})`}</th>
            {(["pay", "bill"] as const).map(side => <td key={side}><input aria-label={`${label} ${side}`} name={`${key}-${side}`} type="number" min="0" max="999999.99" step="0.01" required defaultValue={rate ? dollars(rate.rates[key][side]) : ""} /></td>)}
          </tr>)}</tbody></table>
        <button type="submit">{saving ? "Saving…" : "Save rate"}</button>
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
  </details>;
}

export function CarrierCells({ plan, rates, sequence, cellStyle, disabled, onSave }: {
  plan: CarrierPlan | null; rates: CarrierRate[]; sequence: number; cellStyle: CSSProperties;
  disabled: boolean; onSave: (selection: CarrierSelection | null) => Promise<void>;
}) {
  const [selection, setSelection] = useState(plan?.rate.id ?? "");
  const [quantities, setQuantities] = useState(() => Object.fromEntries(accessorials.map(({ key }) => [key, String(plan?.quantities[key] ?? 0)])));
  const savedOverride = plan?.basePayOverride == null ? "" : dollars(plan.basePayOverride);
  const [basePayOverride, setBasePayOverride] = useState(savedOverride);
  const validOverride = basePayOverride === "" || /^\d{1,6}(?:\.\d{1,2})?$/.test(basePayOverride);
  const rate = selection === plan?.rate.id ? plan.rate : rates.find(item => item.id === selection);
  const lines = plan ? carrierPlanLines(plan) : [];
  const dirty = selection !== (plan?.rate.id ?? "") ||
    Boolean(selection) && (basePayOverride !== savedOverride || accessorials.some(({ key }) => quantities[key] !== String(plan?.quantities[key] ?? 0)));
  const validCounts = Object.values(quantities).every(count => /^\d{1,3}$/.test(count));

  return <>
    <td style={cellStyle}>
      <select aria-label={`Outside carrier for container ${sequence}`} value={selection} disabled={disabled} onChange={event => { setSelection(event.target.value); setBasePayOverride(event.target.value === plan?.rate.id ? savedOverride : ""); }}>
        <option value="">Unassigned</option>
        {rate && !rates.some(item => item.id === rate.id) && <option value={rate.id}>{rate.carrier_name} · {rate.lane}</option>}
        {rates.map(item => <option key={item.id} value={item.id}>{item.carrier_name} ({item.carrier_id}) · {item.lane}</option>)}
      </select>
    </td>
    <td style={cellStyle}>
      <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        Base carrier pay override
        <input aria-label={`Base carrier pay override for container ${sequence}`} type="number" min={0} max={999999.99} step="0.01"
          style={{ width: 88 }} value={basePayOverride} placeholder={rate ? dollars(rate.rates.base.pay) : ""}
          disabled={disabled || !rate} onChange={event => setBasePayOverride(event.target.value)} />
      </label>
      {accessorials.map(({ key, label }) => <label key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        {label}
        <input aria-label={`${label} for container ${sequence}`} type="number" min={0} max={999} step={1} style={{ width: 62 }}
          value={quantities[key]} disabled={disabled || !rate} onChange={event => setQuantities({ ...quantities, [key]: event.target.value })} />
      </label>)}
      {plan && <details>
        <summary>Saved pay ${dollars(lines.reduce((total, line) => total + line.payTotal, 0))} · bill ${dollars(lines.reduce((total, line) => total + line.billTotal, 0))}</summary>
        <ul>{lines.map(line => <li key={line.key}>{line.units} × {line.label}{line.code && ` (${line.code})`} · pay ${dollars(line.payTotal)} · bill ${dollars(line.billTotal)}</li>)}</ul>
      </details>}
      {dirty && <button type="button" disabled={disabled || Boolean(selection) && (!rate || !validCounts || !validOverride)} onClick={() =>
        void onSave(rate ? { rateId: rate.id, rateVersion: rate.updated_at, quantities, basePayOverride } : null)}>Save carrier details</button>}
    </td>
  </>;
}

type OrderPreview = {
  id: string; status: string; carrierId: string | null; carrierPay: number | null;
  charges: { code: string; description: string; units: number | null; amount: number | null }[] | null;
};

export function BookingOrderLookup({ endpoint }: { endpoint: string }) {
  const [order, setOrder] = useState<OrderPreview | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function find() {
    setLoading(true);
    setOrder(null);
    setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setOrder(result.order);
      if (!result.order) setMessage("No verified order found for this container.");
    } catch (error) {
      setMessage((error as Error).message || "Could not search McLeod.");
    } finally { setLoading(false); }
  }

  return <div style={{ marginTop: 8 }}>
    <button type="button" disabled={loading} onClick={() => void find()}>{loading ? "Searching…" : "Find McLeod order"}</button>
    {message && <div role="status">{message}</div>}
    {order && <div role="status">
      <div>SCM order {order.id} · {order.status}</div>
      <div>Carrier {order.carrierId ?? "—"} · Pay {order.carrierPay == null ? "—" : `$${Number(order.carrierPay).toFixed(2)}`}</div>
      {order.charges?.length ? <ul>{order.charges.map((charge, index) => <li key={index}>
        {charge.code} {charge.description}{charge.amount == null ? "" : ` · $${charge.amount.toFixed(2)}`}
      </li>)}</ul> : <div>{order.charges ? "No itemized charges" : "Itemized charges unavailable"}</div>}
    </div>}
  </div>;
}
