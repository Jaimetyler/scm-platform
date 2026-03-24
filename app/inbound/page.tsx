"use client";

import { useMemo, useState } from "react";

type RowData = {
  receivedDate: string;
  mark: string;
  shipper: string;
  bolBC: string;
  balesUnloaded: number | null;
  location: string;
  sourceSheet: string;
};

type ResultStatus = "processed" | "skipped" | "failed" | "needs_review";

type ResultItem = {
  id: string | null;
  rowNum: number | null;
  sheetName: string | null;
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
    default: {
      background: "linear-gradient(180deg, #111827 0%, #0f172a 100%)",
      border: "1px solid #1f2937",
      color: "#f9fafb",
    },
    success: {
      background: "linear-gradient(180deg, rgba(6,95,70,0.22) 0%, rgba(6,78,59,0.3) 100%)",
      border: "1px solid rgba(16,185,129,0.35)",
      color: "#d1fae5",
    },
    danger: {
      background: "linear-gradient(180deg, rgba(127,29,29,0.24) 0%, rgba(69,10,10,0.32) 100%)",
      border: "1px solid rgba(248,113,113,0.35)",
      color: "#fee2e2",
    },
    warning: {
      background: "linear-gradient(180deg, rgba(120,53,15,0.24) 0%, rgba(69,26,3,0.32) 100%)",
      border: "1px solid rgba(251,191,36,0.35)",
      color: "#fef3c7",
    },
  };

  return (
    <div
      style={{
        borderRadius: 16,
        padding: 16,
        minHeight: 98,
        boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
        ...toneStyles[tone],
      }}
    >
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: ResultStatus }) {
  const styles: Record<ResultStatus, React.CSSProperties> = {
    processed: {
      background: "rgba(16,185,129,0.16)",
      color: "#86efac",
      border: "1px solid rgba(16,185,129,0.35)",
    },
    skipped: {
      background: "rgba(245,158,11,0.16)",
      color: "#fde68a",
      border: "1px solid rgba(245,158,11,0.35)",
    },
    needs_review: {
      background: "rgba(249,115,22,0.16)",
      color: "#fdba74",
      border: "1px solid rgba(249,115,22,0.35)",
    },
    failed: {
      background: "rgba(239,68,68,0.16)",
      color: "#fca5a5",
      border: "1px solid rgba(239,68,68,0.35)",
    },
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        ...styles[status],
      }}
    >
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

export default function InboundPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!file) {
      setResult({
        ok: false,
        error: "Please choose an Excel file first.",
      });
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/inbound/process-excel", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as ProcessResponse;
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

  async function markOutsideCarrier(rowId: string | null) {
    if (!rowId) return;

    try {
      setMarkingId(rowId);

      const res = await fetch("/api/inbound/update-disposition", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: rowId,
          disposition: "outside_carrier",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update disposition");
      }

      setResult((prev) => {
        if (!prev?.results) return prev;

        return {
          ...prev,
          outsideCarrierCount: (prev.outsideCarrierCount ?? 0) + 1,
          results: prev.results.map((item) =>
            item.id === rowId
              ? { ...item, disposition: "outside_carrier" }
              : item
          ),
        };
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to mark outside carrier");
    } finally {
      setMarkingId(null);
    }
  }

  const derived = useMemo(() => {
    const rows = result?.results ?? [];

    const processed = rows.filter((r) => r.status === "processed");
    const skipped = rows.filter((r) => r.status === "skipped");
    const failed = rows.filter((r) => r.status === "failed");
    const needsReview = rows.filter((r) => r.status === "needs_review");
    const outsideCarrier = rows.filter((r) => r.disposition === "outside_carrier");
    const unresolvedProblems = rows.filter(
      (r) =>
        (r.status === "failed" || r.status === "needs_review") &&
        r.disposition !== "outside_carrier"
    );

    return {
      processed,
      skipped,
      failed,
      needsReview,
      outsideCarrier,
      unresolvedProblems,
    };
  }, [result]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(37,99,235,0.18) 0%, rgba(15,23,42,1) 28%), linear-gradient(180deg, #0f172a 0%, #020617 100%)",
        color: "#e5e7eb",
        padding: "32px 20px 40px",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 36, marginBottom: 8, color: "#f8fafc" }}>
            Inbound Excel Processor
          </h1>
          <p style={{ margin: 0, color: "#94a3b8" }}>
            Upload a warehouse Excel file and process each row through the inbound sync route.
          </p>
        </div>

        <section
          style={{
            border: "1px solid rgba(148,163,184,0.18)",
            borderRadius: 18,
            padding: 22,
            marginBottom: 24,
            background: "rgba(15,23,42,0.78)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
            backdropFilter: "blur(10px)",
          }}
        >
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14, fontWeight: 700, color: "#e2e8f0" }}>
              Upload inbound file
            </div>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const nextFile = e.target.files?.[0] ?? null;
                setFile(nextFile);
              }}
              style={{ color: "#cbd5e1" }}
            />

            {file && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#94a3b8" }}>
                Selected: <strong style={{ color: "#f8fafc" }}>{file.name}</strong>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button
                type="submit"
                disabled={loading || !file}
                style={{
                  padding: "12px 18px",
                  borderRadius: 12,
                  border: "1px solid rgba(59,130,246,0.45)",
                  background: loading || !file ? "#334155" : "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: loading || !file ? "not-allowed" : "pointer",
                  minWidth: 180,
                  boxShadow:
                    loading || !file ? "none" : "0 10px 24px rgba(37,99,235,0.25)",
                }}
              >
                {loading ? "Processing..." : "Process Excel File"}
              </button>
            </div>
          </form>
        </section>

        {result && (
          <>
            <section
              style={{
                border: "1px solid rgba(148,163,184,0.18)",
                borderRadius: 18,
                padding: 22,
                marginBottom: 24,
                background: "rgba(15,23,42,0.78)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
                backdropFilter: "blur(10px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 18,
                }}
              >
                <div>
                  <h2 style={{ margin: 0, color: "#f8fafc" }}>Summary</h2>
                  <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 14 }}>
                    File: <strong style={{ color: "#e2e8f0" }}>{result.fileName ?? "-"}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowRaw((prev) => !prev)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(148,163,184,0.24)",
                    background: "rgba(15,23,42,0.8)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {showRaw ? "Hide Raw Response" : "Show Raw Response"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <StatCard label="Total Rows" value={result.totalRows ?? 0} />
                <StatCard label="Processed" value={result.processedCount ?? 0} tone="success" />
                <StatCard label="Already Delivered" value={result.skippedCount ?? 0} tone="warning" />
                <StatCard
                  label="Needs Review"
                  value={result.needsReviewCount ?? 0}
                  tone="warning"
                />
                <StatCard label="Failed" value={result.failedCount ?? 0} tone="danger" />
                <StatCard
                  label="Outside Carrier"
                  value={result.outsideCarrierCount ?? derived.outsideCarrier.length}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 16,
                    padding: 16,
                    background: "rgba(2,6,23,0.45)",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 12, color: "#f8fafc" }}>
                    Unresolved Problems
                  </div>

                  {derived.unresolvedProblems.length === 0 ? (
                    <div style={{ color: "#94a3b8" }}>No unresolved problem rows.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {derived.unresolvedProblems.map((row) => (
                        <div
                          key={row.id ?? `${row.rowNum}-${row.mark}`}
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: "1px solid rgba(239,68,68,0.28)",
                            background:
                              row.status === "needs_review"
                                ? "rgba(249,115,22,0.12)"
                                : "rgba(239,68,68,0.12)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              alignItems: "center",
                              flexWrap: "wrap",
                              marginBottom: 8,
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 800, color: "#f8fafc" }}>
                                {row.mark}
                              </div>
                              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                                {row.row.shipper} • {row.row.location || "-"} • Row{" "}
                                {row.rowNum ?? "-"}
                              </div>
                            </div>
                            <StatusPill status={row.status} />
                          </div>

                          <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 10 }}>
                            {row.message}
                          </div>

                          <button
                            type="button"
                            disabled={!row.id || markingId === row.id}
                            onClick={() => markOutsideCarrier(row.id)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid rgba(251,191,36,0.35)",
                              background:
                                !row.id || markingId === row.id
                                  ? "#334155"
                                  : "rgba(245,158,11,0.16)",
                              color: "#fde68a",
                              fontWeight: 700,
                              cursor:
                                !row.id || markingId === row.id ? "not-allowed" : "pointer",
                            }}
                          >
                            {markingId === row.id
                              ? "Marking..."
                              : "Mark Outside Carrier"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 16,
                    padding: 16,
                    background: "rgba(2,6,23,0.45)",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 12, color: "#f8fafc" }}>
                    Outside Carrier
                  </div>

                  {derived.outsideCarrier.length === 0 ? (
                    <div style={{ color: "#94a3b8" }}>No rows marked outside carrier yet.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {derived.outsideCarrier.map((row) => (
                        <div
                          key={row.id ?? `${row.rowNum}-${row.mark}`}
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: "1px solid rgba(251,191,36,0.28)",
                            background: "rgba(245,158,11,0.12)",
                          }}
                        >
                          <div style={{ fontWeight: 800, color: "#f8fafc" }}>{row.mark}</div>
                          <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
                            {row.row.shipper} • {row.row.location || "-"} • Row {row.rowNum ?? "-"}
                          </div>
                          <div style={{ fontSize: 12, color: "#fde68a", marginTop: 6 }}>
                            Marked as outside carrier
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {showRaw && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: "#f8fafc" }}>
                    Raw Response
                  </div>
                  <pre
                    style={{
                      marginTop: 10,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 12,
                      color: "#cbd5e1",
                      background: "rgba(2,6,23,0.55)",
                      border: "1px solid rgba(148,163,184,0.12)",
                      padding: 14,
                      borderRadius: 12,
                      maxHeight: 500,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </section>

            <section
              style={{
                border: "1px solid rgba(148,163,184,0.18)",
                borderRadius: 18,
                padding: 22,
                background: "rgba(15,23,42,0.78)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
                backdropFilter: "blur(10px)",
              }}
            >
              <h2 style={{ marginTop: 0, color: "#f8fafc" }}>Detailed Results</h2>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 1200,
                    borderCollapse: "collapse",
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>Row</th>
                      <th style={thStyle}>Mark</th>
                      <th style={thStyle}>Shipper</th>
                      <th style={thStyle}>Bales</th>
                      <th style={thStyle}>Location</th>
                      <th style={thStyle}>Matched Order</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Disposition</th>
                      <th style={thStyle}>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.results ?? []).map((row) => (
                      <tr key={row.id ?? `${row.rowNum}-${row.mark}`}>
                        <td style={tdStyle}>{row.rowNum ?? "-"}</td>
                        <td style={tdStyle}>{row.mark}</td>
                        <td style={tdStyle}>{row.row.shipper}</td>
                        <td style={tdStyle}>
                          {row.row.balesUnloaded ?? row.row.bolBC ?? "-"}
                        </td>
                        <td style={tdStyle}>{row.row.location || "-"}</td>
                        <td style={tdStyle}>{row.matchedOrderId || "-"}</td>
                        <td style={tdStyle}>
                          <StatusPill status={row.status} />
                        </td>
                        <td style={tdStyle}>{row.disposition}</td>
                        <td style={tdStyle}>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.error && (
                <div style={{ color: "#fca5a5", marginTop: 16 }}>
                  <strong>Error:</strong> {result.error}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid rgba(148,163,184,0.18)",
  padding: "12px 10px",
  verticalAlign: "top",
  fontSize: 13,
  color: "#94a3b8",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  padding: "12px 10px",
  verticalAlign: "top",
  color: "#e5e7eb",
};