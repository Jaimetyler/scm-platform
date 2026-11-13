"use client";

import { useRef, useState, type FormEvent } from "react";
import { accessorials, carrierPlanLines, rateItems, type CarrierPlan, type CarrierRate, type CarrierSelection, type CarrierBatchAction, type Quantities, type CustomerBillRates } from "@/lib/warehouse/outbound/carrier-rates";

const dollars = (cents: number) => (cents / 100).toFixed(2);


export function CarrierRateManager(props: { rates: CarrierRate[]; endpoint: string; onSaved: (rate: CarrierRate) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  return <>
    <button type="button" className="carrier-rates-button" onClick={() => dialog.current?.showModal()}>Carrier rates</button>
    <dialog ref={dialog} className="carrier-details-dialog carrier-rates-dialog" aria-labelledby="carrier-rates-title">
      <div className="carrier-dialog-heading">
        <h2 id="carrier-rates-title">Carrier rates</h2>
        <form method="dialog"><button type="submit" disabled={saving}>Close</button></form>
      </div>
      <CarrierRateForm {...props} onSaving={setSaving} />
    </dialog>
  </>;
}

export function CarrierRateForm({ rates, endpoint, onSaved, onSaving }: {
  rates: CarrierRate[]; endpoint: string; onSaved: (rate: CarrierRate) => void; onSaving?: (saving: boolean) => void;
}) {
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const rate = rates.find(item => item.id === selected);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amounts = Object.fromEntries(rateItems.map(({ key }) => [key, {
      pay: form.get(`${key}-pay`),
    }]));
    setSaving(true);
    onSaving?.(true);
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
    } finally { setSaving(false); onSaving?.(false); }
  }

  return <>
    <label>Rate card <select value={selected} disabled={saving} onChange={event => { setSelected(event.target.value); setMessage(""); }}>
      <option value="">Add a carrier rate</option>
      {rates.map(item => <option key={item.id} value={item.id}>{item.carrier_name} ({item.carrier_id}) · {item.lane}</option>)}
    </select></label>
    <form key={rate ? `${rate.id}:${rate.updated_at}` : "new"} onSubmit={submit}>
      <fieldset disabled={saving} style={{ display: "grid", gap: 8, maxWidth: 620 }}>
        <label>McLeod carrier ID <input name="carrier" required maxLength={30} defaultValue={rate?.carrier_id} /></label>
        <label>Carrier name <input name="name" required maxLength={100} defaultValue={rate?.carrier_name} /></label>
        <label>Lane / return location <input name="lane" required maxLength={100} defaultValue={rate?.lane} /></label>
        <table><thead><tr><th scope="col">Charge</th><th scope="col">Carrier pay ($)</th></tr></thead>
          <tbody>{rateItems.map(({ key, label, code }) => <tr key={key}>
            <th scope="row">{label}{code && ` (${code})`}</th>
            <td><input aria-label={`${label} pay`} name={`${key}-pay`} type="number" min="0" max="999999.99" step="0.01" required defaultValue={rate ? dollars(rate.rates[key].pay) : ""} /></td>
          </tr>)}</tbody></table>
        <button type="submit">{saving ? "Saving…" : "Save rate"}</button>
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
  </>;
}

export function CarrierEditor({ plan, rates, billing, sequence, disabled, onSave }: {
  plan: CarrierPlan | null; rates: CarrierRate[]; billing: CustomerBillRates | null; sequence: number;
  disabled: boolean; onSave: (selection: CarrierSelection | null) => Promise<unknown>;
}) {
  const [selection, setSelection] = useState(plan?.rate.id ?? "");
  const [quantities, setQuantities] = useState(() => Object.fromEntries(accessorials.map(({ key }) => [key, String(plan?.quantities[key] ?? 0)])));
  const savedOverride = plan?.basePayOverride == null ? "" : dollars(plan.basePayOverride);
  const [basePayOverride, setBasePayOverride] = useState(savedOverride);
  const validOverride = basePayOverride === "" || /^\d{1,6}(?:\.\d{1,2})?$/.test(basePayOverride);
  const rate = selection === plan?.rate.id ? plan.rate : rates.find(item => item.id === selection);
  const lines = plan ? carrierPlanLines(plan, billing) : [];
  const dirty = selection !== (plan?.rate.id ?? "") ||
    Boolean(selection) && (basePayOverride !== savedOverride || accessorials.some(({ key }) => quantities[key] !== String(plan?.quantities[key] ?? 0)));
  const validCounts = Object.values(quantities).every(count => /^\d{1,3}$/.test(count));

  return <>
    <div className="carrier-editor">
      <select aria-label={`Outside carrier for container ${sequence}`} value={selection} disabled={disabled} onChange={event => { setSelection(event.target.value); setBasePayOverride(event.target.value === plan?.rate.id ? savedOverride : ""); }}>
        <option value="">Unassigned</option>
        {rate && !rates.some(item => item.id === rate.id) && <option value={rate.id}>{rate.carrier_name} · {rate.lane}</option>}
        {rates.map(item => <option key={item.id} value={item.id}>{item.carrier_name} ({item.carrier_id}) · {item.lane}</option>)}
      </select>
    </div>
    <div className="carrier-editor">
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
        <summary>Saved pay ${dollars(lines.reduce((total, line) => total + line.payTotal, 0))}</summary>
        <ul>{lines.map(line => <li key={line.key}>{line.units} × {line.label}{line.code && ` (${line.code})`} · pay ${dollars(line.payTotal)} · bill {line.billTotal == null ? "rate unavailable" : `$${dollars(line.billTotal)}`}</li>)}</ul>
      </details>}
      {dirty && <button type="button" disabled={disabled || Boolean(selection) && (!rate || !validCounts || !validOverride)} onClick={() =>
        void onSave(rate ? { rateId: rate.id, rateVersion: rate.updated_at, quantities, basePayOverride } : null)}>Save carrier details</button>}
    </div>
  </>;
}

export function CarrierSummary({ plan }: { plan: CarrierPlan | null }) {
  if (!plan) return <span className="carrier-muted">Unassigned</span>;
  const lines = carrierPlanLines(plan).filter(line => line.key !== "base");
  return <div className="carrier-summary">
    <strong>{plan.rate.carrier_name}</strong>
    {lines.length > 0 && <small>{lines.map(line => `${line.units} ${line.label.toLowerCase()}`).join(" · ")}</small>}
  </div>;
}

export function CarrierBatchToolbar({ rates, plans, billing, disabled, onApply, onClear }: {
  rates: CarrierRate[]; plans: (CarrierPlan | null)[]; billing: CustomerBillRates | null; disabled: boolean;
  onApply: (action: CarrierBatchAction) => Promise<void>; onClear: () => void;
}) {
  const [mode, setMode] = useState<"carrier" | "charge" | null>(null);
  const [rateId, setRateId] = useState("");
  const [units, setUnits] = useState<Record<keyof Quantities, string>>({ chassisDays: "", chassisSplits: "", stopoffs: "" });
  const rate = rates.find(item => item.id === rateId);
  const allAssigned = plans.every(Boolean);
  const quantities = Object.fromEntries(accessorials.map(({ key }) => [key, Number(units[key])])) as Quantities;
  const validUnits = Object.values(units).every(value => /^\d{0,3}$/.test(value)) && Object.values(quantities).some(value => value > 0);
  const exceedsLimit = validUnits && plans.some(plan => plan && accessorials.some(({ key }) => plan.quantities[key] + quantities[key] > 999));
  const canAddCharges = allAssigned && validUnits && !exceedsLimit;
  const added = plans.reduce((total, plan) => {
    if (plan && canAddCharges) for (const { key } of accessorials) {
      total.pay += plan.rate.rates[key].pay * quantities[key];

    }
    return total;
  }, { pay: 0 });
  const addedBill = accessorials.reduce<number | null>((total, { key }) => {
    if (!quantities[key]) return total;
    const rate = billing?.[key];
    return total == null || rate == null ? null : total + rate * quantities[key] * plans.length;
  }, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (mode === "carrier" && rate) await onApply({ rate });
    if (mode === "charge" && canAddCharges) await onApply({ charges: quantities });
  }

  return <div className="carrier-batch">
    <div className="carrier-batch-actions">
      <strong>{plans.length} selected</strong>
      <button type="button" aria-pressed={mode === "carrier"} disabled={disabled || !rates.length} onClick={() => setMode("carrier")}>Assign carrier</button>
      <button type="button" aria-pressed={mode === "charge"} disabled={disabled || !allAssigned} onClick={() => setMode("charge")}>Add charges</button>
      <button type="button" disabled={disabled} onClick={onClear}>Clear selection</button>
    </div>
    {!rates.length && <small>Add a carrier rate card to assign a carrier.</small>}
    {rates.length > 0 && !allAssigned && <small>Assign a carrier to every selected row to add a charge.</small>}
    {mode && <form onSubmit={submit} className="carrier-batch-actions">
      {mode === "carrier" ? <label>Carrier rate card <select value={rateId} disabled={disabled} onChange={event => setRateId(event.target.value)}>
        <option value="">Choose carrier</option>
        {rates.map(item => <option key={item.id} value={item.id}>{item.carrier_name} · {item.lane}</option>)}
      </select></label> : <>
        {accessorials.map(({ key, label }) => <label key={key}>{label} per container
          <input type="number" min="0" max="999" step="1" placeholder="0" value={units[key]} disabled={disabled}
            onChange={event => setUnits(current => ({ ...current, [key]: event.target.value }))} />
        </label>)}
        {canAddCharges && <span>Added pay ${dollars(added.pay)} · {addedBill == null ? "Customer billing rate missing" : `Added bill $${dollars(addedBill)}`}</span>}
        {exceedsLimit && <span role="alert">A container can have up to 999 units per charge.</span>}
      </>}
      <button type="submit" disabled={disabled || (mode === "carrier" ? !rate : !canAddCharges)}>
        {disabled ? "Saving…" : mode === "carrier" ? "Apply carrier" : "Add to selected"}
      </button>
      <button type="button" disabled={disabled} onClick={() => setMode(null)}>Cancel</button>
    </form>}
  </div>;
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
