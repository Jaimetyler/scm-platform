"use client";

import { useState } from "react";
import Link from "next/link";

type ImportResult = {
  ok: boolean;
  fileName?: string;
  csvRows?: number;
  orderIds?: number;
  saved?: number;
  failed?: number;
  error?: string;
  results?: Array<{
    orderId: string;
    ok: boolean;
    customerId?: string;
    blnum?: string;
    bales?: number;
    policyCode?: string | null;
    policyType?: string | null;
    error?: string;
    skipped?: boolean;
    reason?: string;
  }>;
};

export default function SavannahLateFeeImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload() {
    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/late-fees/savannah/import-candidates", {
        method: "POST",
        body: form,
      });

      const data = (await res.json()) as ImportResult;
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/late-fees/savannah" style={{ color: "#93c5fd" }}>
          ← Back to Savannah Late Fees
        </Link>
      </div>

      <h1 style={{ color: "#f8fafc", marginBottom: 8 }}>
        Savannah Late Fee Import
      </h1>

      <p style={{ color: "#94a3b8", marginBottom: 24 }}>
        Upload the FlowLogix CSV export. The importer will read the order IDs,
        hydrate them from McLeod, and update late-fee snapshots.
      </p>

      <div
        style={{
          border: "1px solid rgba(148,163,184,0.2)",
          background: "rgba(15,23,42,0.75)",
          borderRadius: 16,
          padding: 18,
          marginBottom: 20,
        }}
      >
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ color: "#e5e7eb", marginBottom: 16 }}
        />

        <br />

        <button
          onClick={upload}
          disabled={!file || loading}
          style={{
            border: "0",
            borderRadius: 10,
            padding: "10px 14px",
            background: !file || loading ? "#334155" : "#2563eb",
            color: "#fff",
            fontWeight: 700,
            cursor: !file || loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Importing..." : "Import CSV"}
        </button>
      </div>

      {result ? (
        <div
          style={{
            border: "1px solid rgba(148,163,184,0.2)",
            background: "rgba(15,23,42,0.75)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <h2 style={{ color: result.ok ? "#86efac" : "#fca5a5" }}>
            {result.ok ? "Import Complete" : "Import Failed"}
          </h2>

          {result.error ? (
            <p style={{ color: "#fca5a5" }}>{result.error}</p>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <Stat label="CSV Rows" value={result.csvRows ?? 0} />
            <Stat label="Order IDs" value={result.orderIds ?? 0} />
            <Stat label="Saved" value={result.saved ?? 0} />
            <Stat label="Failed" value={result.failed ?? 0} />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 900,
              }}
            >
              <thead>
                <tr>
                  {[
                    "Status",
                    "Order",
                    "Customer",
                    "BLNUM",
                    "Bales",
                    "Policy",
                    "Type",
                    "Message",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        color: "#cbd5e1",
                        borderBottom: "1px solid rgba(148,163,184,0.2)",
                        padding: "10px 8px",
                        fontSize: 12,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {(result.results ?? []).slice(0, 300).map((row, idx) => (
                  <tr key={`${row.orderId}-${idx}`}>
                    <td style={cellStyle}>
                      <span style={{ color: row.ok ? "#86efac" : "#fca5a5" }}>
                        {row.ok ? "Saved" : row.skipped ? "Skipped" : "Failed"}
                      </span>
                    </td>
                    <td style={cellStyle}>{row.orderId}</td>
                    <td style={cellStyle}>{row.customerId ?? ""}</td>
                    <td style={cellStyle}>{row.blnum ?? ""}</td>
                    <td style={cellStyle}>{row.bales ?? ""}</td>
                    <td style={cellStyle}>{row.policyCode ?? ""}</td>
                    <td style={cellStyle}>{row.policyType ?? ""}</td>
                    <td style={cellStyle}>
                      {row.error ?? row.reason ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,0.16)",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: 12 }}>{label}</div>
      <div style={{ color: "#f8fafc", fontSize: 24, fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  color: "#e2e8f0",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  padding: "9px 8px",
  whiteSpace: "nowrap",
};