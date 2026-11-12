"use client";

import { useState, type FormEvent } from "react";

type Fields = { bol: string; orderedBy: string; early: string; late: string };
type Preview = {
  action: "create" | "update"; fingerprint: string; writable: boolean; unchanged: boolean;
  before: { orderId: string; rate: number; chassis: number; total: number; payee: string | null; pay: number | null } | null;
};
const money = (value: number | null) => value == null ? "—" : `$${Number(value).toFixed(2)}`;

export default function DallasOrderPilot({ endpoint, containerId, mark }: { endpoint: string; containerId: string; mark: string }) {
  const [fields, setFields] = useState<Fields>({ bol: mark, orderedBy: "", early: "", late: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const applying = Boolean(preview);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, containerId, action: applying ? "apply" : "preview", fingerprint: preview?.fingerprint }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "The Dallas pilot request failed.");
      if (applying) {
        setPreview(null);
        setMessage(`Verified SCM order ${result.orderId} in McLeod.`);
      } else setPreview(result);
    } catch (reason) {
      setPreview(null);
      setMessage((reason as Error).message);
    } finally { setBusy(false); }
  }

  const before = preview?.before;
  return <details style={{ marginTop: 8 }}>
    <summary>Dallas order pilot</summary>
    <form onSubmit={submit}>
      {!preview && <fieldset disabled={busy} style={{ display: "grid", gap: 4 }}>
        <legend>Fields used when creating an order</legend>
        {(["bol", "orderedBy", "early", "late"] as const).map((field, index) =>
          <label key={field}>{["BOL", "Ordered by", "Schedule start", "Schedule end"][index]}
            <input type={index < 2 ? "text" : "date"} maxLength={40} value={fields[field]} onChange={event =>
              setFields(current => ({ ...current, [field]: event.target.value }))} />
          </label>)}
      </fieldset>}
      {preview && <div>
        <strong>{before ? `SCM order ${before.orderId}` : "New SCM order"}</strong>
        {!before && <p>BOL {fields.bol} · Ordered by {fields.orderedBy} · {fields.early} to {fields.late}</p>}
        <table><thead><tr><th>Amount</th>{before && <th>Current</th>}<th>Proposed</th></tr></thead>
          <tbody>
            <tr><th>Freight</th>{before && <td>{money(before.rate)}</td>}<td>$545.00</td></tr>
            <tr><th>Chassis (DSCM)</th>{before && <td>{money(before.chassis)}</td>}<td>$35.00</td></tr>
            <tr><th>Customer total</th>{before && <td>{money(before.total)}</td>}<td>$580.00</td></tr>
            <tr><th>Flat carrier pay</th>{before && <td>{before.payee} {money(before.pay)}</td>}<td>SCMIRIGA $392.93</td></tr>
          </tbody></table>
        {preview.unchanged && <p>Order already matches.</p>}
        {!preview.unchanged && !preview.writable && <p>McLeod writes are disabled in this environment.</p>}
        <button type="button" disabled={busy} onClick={() => setPreview(null)}>Back</button>
      </div>}
      {(!preview || preview.writable && !preview.unchanged) && <button type="submit" disabled={busy}>
        {busy ? "Working…" : !preview ? "Preview McLeod order" : preview.action === "create" ? "Create order" : "Update order"}
      </button>}
    </form>
    {message && <p role="status">{message}</p>}
  </details>;
}
