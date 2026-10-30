"use client";

import { useState } from "react";

type AnyRow = Record<string, any>;

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function num(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function SavannahMonthlyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function handleUpload() {
    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/late-fees/savannah/monthly-preview", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({
          ok: false,
          error: data?.error ?? `Request failed with status ${res.status}`,
          ...data,
        });
        return;
      }

      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected upload error",
      });
    } finally {
      setLoading(false);
    }
  }

  function downloadExceptions() {
    const rows = result?.exceptionRows ?? [];
    if (!rows.length) return;

    const headers = [
      "rowNumber",
      "orderId",
      "customer",
      "locationCode",
      "baleCount",
      "actualDelivery",
      "originalDate",
      "rawDaysLate",
      "status",
      "reason",
    ];

    const csv = [
      headers.join(","),
      ...rows.map((row: AnyRow) =>
        headers.map((header) => csvEscape(row[header])).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "savannah-monthly-exceptions.csv";
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 24, color: "#fff" }}>
      <h1>Savannah Monthly Reconciliation</h1>

      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button onClick={handleUpload} disabled={!file || loading}>
          {loading ? "Processing..." : "Preview Monthly Fees"}
        </button>

        {result?.ok && result?.exceptionRows?.length > 0 && (
          <button onClick={downloadExceptions}>
            Download Exception Report
          </button>
        )}
      </div>

      {result?.ok && (
        <>
          <div
            style={{
              marginTop: 24,
              padding: 16,
              border: "1px solid #2f855a",
              borderRadius: 8,
              background: "rgba(47, 133, 90, 0.12)",
            }}
          >
            Imported <strong>{num(result.importedRows)}</strong> rows ·{" "}
            <strong>{num(result.billableRows)}</strong> billable ·{" "}
            <strong>{num(result.skippedRows)}</strong> skipped
          </div>

          {result.skippedRows > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: 16,
                border: "1px solid #b7791f",
                borderRadius: 8,
                background: "rgba(183, 121, 31, 0.12)",
              }}
            >
              <strong>Review needed:</strong>{" "}
              {num(result.summary?.missingData)} missing-data rows,{" "}
              {num(result.summary?.noPolicy)} missing-policy rows, and{" "}
              {num(result.summary?.notLate)} non-billable rows.
            </div>
          )}

          <div
            style={{
              marginTop: 24,
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <Card
              title="Total Fees"
              value={money(result.totals?.totalLateFees)}
            />
            <Card
              title="Billable Orders"
              value={num(result.totals?.orders)}
            />
            <Card
              title="Total Bales"
              value={num(result.totals?.totalBales)}
            />
            <Card
              title="Skipped Rows"
              value={num(result.skippedRows)}
            />
          </div>

          <Section title="Customer Summary">
            <Table
              rows={result.customerSummary ?? []}
              columns={[
                ["customer", "Customer"],
                ["orders", "Orders"],
                ["bales", "Bales"],
                ["ok", "Billable"],
                ["missingData", "Missing Data"],
                ["noPolicy", "No Policy"],
                ["notLate", "Not Late"],
                ["totalLateFees", "Fees"],
              ]}
            />
          </Section>

          <Section title="Location Summary">
            <Table
              rows={result.locationSummary ?? []}
              columns={[
                ["locationCode", "Location"],
                ["orders", "Orders"],
                ["bales", "Bales"],
                ["ok", "Billable"],
                ["missingData", "Missing Data"],
                ["noPolicy", "No Policy"],
                ["notLate", "Not Late"],
                ["policyType", "Policy"],
                ["policyAmount", "Amount"],
                ["graceDays", "Grace"],
                ["totalLateFees", "Fees"],
              ]}
            />
          </Section>

          {result.exceptionRows?.length > 0 && (
            <Section title="Exceptions">
              <Table
                rows={result.exceptionRows}
                columns={[
                  ["rowNumber", "CSV Row"],
                  ["orderId", "Mark / Order"],
                  ["customer", "Customer"],
                  ["locationCode", "Location"],
                  ["baleCount", "Bales"],
                  ["actualDelivery", "Actual Delivery"],
                  ["originalDate", "Original Date"],
                  ["rawDaysLate", "Days Late"],
                  ["status", "Status"],
                  ["reason", "Reason"],
                ]}
              />
            </Section>
          )}
        </>
      )}

      {result && !result.ok && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            color: "#fecaca",
            background: "rgba(127, 29, 29, 0.35)",
            border: "1px solid #991b1b",
            borderRadius: 8,
          }}
        >
          <strong>{result.error ?? "Unable to process report"}</strong>

          {result.missingRequiredFields?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              Missing required fields:{" "}
              {result.missingRequiredFields.join(", ")}
            </div>
          )}

          {result.detectedHeaders?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              Detected headers: {result.detectedHeaders.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: "#111",
        padding: 16,
        borderRadius: 8,
        minWidth: 180,
        border: "1px solid #2a2a2a",
      }}
    >
      <div style={{ color: "#aaa", fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 32 }}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Table({
  rows,
  columns,
}: {
  rows: AnyRow[];
  columns: [string, string][];
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid #333",
        borderRadius: 8,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#111",
        }}
      >
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th key={key} style={th}>
                {label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ ...td, color: "#888", textAlign: "center" }}
              >
                No rows
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {columns.map(([key]) => (
                  <td key={key} style={td}>
                    {formatCell(key, row[key])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(key: string, value: any) {
  if (key.toLowerCase().includes("fee")) return money(value);
  if (typeof value === "number") return num(value);
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #333",
  color: "#aaa",
  fontSize: 13,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #222",
  fontSize: 14,
  verticalAlign: "top",
};