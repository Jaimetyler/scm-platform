"use client";

import { useMemo, useState } from "react";

type Terminal = "SAV" | "HOU" | "DAL";

type Charge = {
  tariff_id?: number;
  charge_id: string;
  description?: string;
  units: number;
  amount: number;
};

type PreviewOrder = {
  blnum: string;
  charges: Charge[];
};

export default function OrderChargesPage() {
  const [terminal, setTerminal] = useState<Terminal>("HOU");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<PreviewOrder[]>([]);
  const [skipped, setSkipped] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => {
    const orderCount = preview.length;
    const chargeCount = preview.reduce((sum, o) => sum + o.charges.length, 0);
    const amount = preview.reduce(
      (sum, o) => sum + o.charges.reduce((s, c) => s + Number(c.amount || 0), 0),
      0
    );
    return { orderCount, chargeCount, amount };
  }, [preview]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setCsvText(await file.text());
    setPreview([]);
    setSkipped([]);
    setResult(null);
  }

  async function runPreview() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/order-charges/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, csvText }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Preview failed");

      setPreview(data.preview || []);
      setSkipped(data.skipped || []);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function applyCharges() {
    if (!preview.length) return;

    const confirmed = window.confirm(
      `Apply ${totals.chargeCount} charges to ${totals.orderCount} McLeod orders?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const res = await fetch("/api/order-charges/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview }),
      });

      const data = await res.json();
      setResult(data);

      if (!data.ok) throw new Error(data.error || "Apply failed");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", color: "white" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Billing Charges Upload</h1>
      <p style={{ opacity: 0.75, marginBottom: 24 }}>
        Upload billing details, preview mapped charges, then apply them to existing McLeod orders by Shipping Order # / BOL.
      </p>

      <section style={card}>
        <label>Terminal</label>
        <select
          value={terminal}
          onChange={(e) => setTerminal(e.target.value as Terminal)}
          style={input}
        >
          <option value="HOU">Houston</option>
          <option value="DAL">Dallas</option>
          <option value="SAV">Savannah</option>
        </select>

        <div style={{ marginTop: 16 }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
          {fileName && <p style={{ opacity: 0.75 }}>Selected: {fileName}</p>}
        </div>

        <button
          onClick={runPreview}
          disabled={!csvText || loading}
          style={button}
        >
          {loading ? "Working..." : "Preview Charges"}
        </button>
      </section>

      {preview.length > 0 && (
        <section style={card}>
          <h2>Preview</h2>
          <div style={stats}>
            <div>Orders: {totals.orderCount}</div>
            <div>Charges: {totals.chargeCount}</div>
            <div>Total Net: ${totals.amount.toFixed(2)}</div>
            <div>Skipped: {skipped.length}</div>
          </div>

          <button
  onClick={applyCharges}
  disabled={loading || preview.length === 0}
  style={{
    marginTop: 20,
    padding: "12px 18px",
    borderRadius: 12,
    border: 0,
    cursor: preview.length ? "pointer" : "not-allowed",
    fontWeight: 700,
    background: preview.length ? "#22c55e" : "#475569",
    color: "white",
  }}
>
  Apply Charges to McLeod ({preview.length} orders)
</button>

          <div style={{ overflowX: "auto", marginTop: 20 }}>
            <table style={table}>
              <thead>
                <tr>
                  <th>BOL</th>
                  <th>Charge</th>
                  <th>Description</th>
                  <th>Units</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.flatMap((order) =>
                  order.charges.map((c, idx) => (
                    <tr key={`${order.blnum}-${idx}`}>
                      <td>{order.blnum}</td>
                      <td>{c.charge_id}</td>
                      <td>{c.description}</td>
                      <td>{c.units}</td>
                      <td>${Number(c.amount).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {skipped.length > 0 && (
        <section style={card}>
          <h2>Skipped / Unmapped Rows</h2>
          <pre style={pre}>{JSON.stringify(skipped, null, 2)}</pre>
        </section>
      )}

      {result && (
        <section style={card}>
          <h2>Apply Results</h2>
          <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}

const card: React.CSSProperties = {
  background: "rgba(15,23,42,0.86)",
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 18,
  padding: 20,
  marginBottom: 20,
};

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 300,
  padding: 10,
  marginTop: 6,
  borderRadius: 10,
};

const button: React.CSSProperties = {
  marginTop: 18,
  padding: "10px 16px",
  borderRadius: 12,
  border: 0,
  cursor: "pointer",
  fontWeight: 700,
};

const stats: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
  margin: "16px 0",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const pre: React.CSSProperties = {
  background: "#020617",
  padding: 16,
  borderRadius: 12,
  overflowX: "auto",
};