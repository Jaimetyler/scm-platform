"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

type Terminal = "SAV" | "HOU";

type RowData = {
  receivedDate: string;
  mark: string;
  shipper: string;
  bolBC: string;
  balesUnloaded: number | null;
  location: string;
  sourceSheet: string;
  terminal?: Terminal;
  equipmentType?: "V" | "F" | null;
};

type ResultStatus = "processed" | "skipped" | "failed" | "needs_review";

type ResultItem = {
  id: string | null;
  rowNum: number | null;
  sheetName: string | null;
  terminal: Terminal;
  equipmentType: "V" | "F" | null;
  mark: string;
  status: ResultStatus;
  ok: boolean;
  matchedOrderId: string;
  message: string;
  disposition: string;
  row: RowData;
  response: unknown;
};

type ProcessResponse = {
  ok: boolean;
  routeVersion?: string;
  mode?: string;
  terminal?: Terminal;
  fileName?: string;
  totalRows?: number;
  processedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  needsReviewCount?: number;
  outsideCarrierCount?: number;
  error?: string;
  results?: ResultItem[];
};

function StatCard(props: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  const { label, value, tone = "default" } = props;

  const toneStyles: Record<string, React.CSSProperties> = {
    default: { border: "1px solid #1f2937" },
    success: { border: "1px solid rgba(16,185,129,0.35)" },
    danger: { border: "1px solid rgba(248,113,113,0.35)" },
    warning: { border: "1px solid rgba(251,191,36,0.35)" },
  };

  return (
    <div
      style={{
        borderRadius: 16,
        padding: 16,
        background: "rgba(2,6,23,0.4)",
        ...toneStyles[tone],
      }}
    >
      <div style={{ fontSize: 13, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  return (
    <span
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
        background: "rgba(148,163,184,0.16)",
        border: "1px solid rgba(148,163,184,0.35)",
      }}
    >
      {value}
    </span>
  );
}

function DispositionPill({ value }: { value: string }) {
  return (
    <span
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
        background: "rgba(16,185,129,0.16)",
        border: "1px solid rgba(16,185,129,0.35)",
      }}
    >
      {value || "-"}
    </span>
  );
}

export default function InboundPage() {
  const [file, setFile] = useState<File | null>(null);
  const [terminal, setTerminal] = useState<Terminal>("SAV");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!file) {
      setResult({ ok: false, error: "Please choose an Excel file first." });
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("terminal", terminal);

      const res = await fetch("/api/inbound/process-excel", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  const rows = result?.results ?? [];

  const derived = useMemo(() => {
    return {
      processed: rows.filter((r) => r.status === "processed"),
      skipped: rows.filter((r) => r.status === "skipped"),
      failed: rows.filter((r) => r.status === "failed"),
      needsReview: rows.filter((r) => r.status === "needs_review"),
    };
  }, [rows]);

  return (
    <main style={{ maxWidth: 1560, margin: "0 auto" }}>
      <PlatformPageHeader
  title="Inbound Processor"
  subtitle="Upload and process check-in sheets into SCM Platform."
  actions={
    <>
      <Link href="/" style={secondaryButtonStyle}>
        ← Back Home
      </Link>

      <Link href="/inbound/history" style={primaryLinkButtonStyle}>
        View History
      </Link>
    </>
  }
/>

      {/* FORM */}
      <PlatformPanel>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 14, flexWrap: "wrap" }}
        >
          <select
            value={terminal}
            onChange={(e) => setTerminal(e.target.value as Terminal)}
            style={inputStyle}
          >
            <option value="SAV">Savannah</option>
            <option value="HOU">Houston</option>
          </select>

          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={inputStyle}
          />

          <button type="submit" style={primaryButtonStyle}>
            {loading ? "Processing..." : "Process File"}
          </button>

          {result && (
            <button
              type="button"
              onClick={() => setShowRaw((p) => !p)}
              style={secondaryButtonStyle}
            >
              Toggle Raw
            </button>
          )}
        </form>
      </PlatformPanel>

      {/* STATS */}
      {result && (
        <PlatformPanel>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))" }}>
            <StatCard label="Processed" value={derived.processed.length} tone="success" />
            <StatCard label="Skipped" value={derived.skipped.length} tone="warning" />
            <StatCard label="Failed" value={derived.failed.length} tone="danger" />
            <StatCard label="Needs Review" value={derived.needsReview.length} tone="warning" />
          </div>
        </PlatformPanel>
      )}

      {/* TABLE */}
      {result && (
        <PlatformPanel>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1400 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Mark</th>
                  <th style={thStyle}>Shipper</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Disposition</th>
                  <th style={thStyle}>Matched</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{r.mark}</td>
                    <td style={tdStyle}>{r.row.shipper}</td>
                    <td style={tdStyle}><StatusPill value={r.status} /></td>
                    <td style={tdStyle}><DispositionPill value={r.disposition} /></td>
                    <td style={tdStyle}>{r.matchedOrderId || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PlatformPanel>
      )}
    </main>
  );
}
const primaryLinkButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(99,102,241,0.42)",
  background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 800,
  textDecoration: "none",
  minHeight: 46,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 8px 22px rgba(79,70,229,0.28)",
};

const inputStyle = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(15,23,42,0.82)",
  color: "#e2e8f0",
};

const primaryButtonStyle = {
  padding: "12px 16px",
  borderRadius: 12,
  background: "#4f46e5",
  color: "#fff",
  fontWeight: 800,
};

const secondaryButtonStyle = {
  padding: "12px 16px",
  borderRadius: 12,
  background: "rgba(15,23,42,0.84)",
  color: "#e2e8f0",
};

const linkButtonStyle = secondaryButtonStyle;

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "14px",
  color: "#94a3b8",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "14px",
  whiteSpace: "nowrap",
  borderTop: "1px solid rgba(148,163,184,0.08)",
};