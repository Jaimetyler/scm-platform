"use client";

import { useEffect, useState } from "react";

type HistoryRow = {
  id: string;
  received_date: string;
  mark: string;
  shipper: string;
  bale_count: number | null;
  location: string | null;
  source_sheet: string | null;
  matched_order_id: string | null;
  status: string;
  reason: string | null;
  disposition: string;
  derivedDisposition: string;
  seen_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type HistoryResponse = {
  ok: boolean;
  filters?: {
    startDate?: string | null;
    endDate?: string | null;
    customer?: string | null;
  };
  summary?: {
    totalRows: number;
    matchedTotal: number;
    outsideCarrierTotal: number;
    unresolvedTotal: number;
    classifiedTotal: number;
    matchedPct: number;
    outsideCarrierPct: number;
  };
  customers?: string[];
  rows?: HistoryRow[];
  error?: string;
};

function StatCard(props: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "danger" | "warning";
  subtext?: string;
}) {
  const { label, value, tone = "default", subtext } = props;

  const toneStyles: Record<string, React.CSSProperties> = {
    default: {
      background: "linear-gradient(180deg, #111827 0%, #0f172a 100%)",
      border: "1px solid #1f2937",
      color: "#f9fafb",
    },
    success: {
      background:
        "linear-gradient(180deg, rgba(6,95,70,0.22) 0%, rgba(6,78,59,0.3) 100%)",
      border: "1px solid rgba(16,185,129,0.35)",
      color: "#d1fae5",
    },
    danger: {
      background:
        "linear-gradient(180deg, rgba(127,29,29,0.24) 0%, rgba(69,10,10,0.32) 100%)",
      border: "1px solid rgba(248,113,113,0.35)",
      color: "#fee2e2",
    },
    warning: {
      background:
        "linear-gradient(180deg, rgba(120,53,15,0.24) 0%, rgba(69,26,3,0.32) 100%)",
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
      {subtext ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>{subtext}</div>
      ) : null}
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();

  let style: React.CSSProperties = {
    background: "rgba(148,163,184,0.16)",
    color: "#cbd5e1",
    border: "1px solid rgba(148,163,184,0.35)",
  };

  if (normalized === "processed") {
    style = {
      background: "rgba(16,185,129,0.16)",
      color: "#86efac",
      border: "1px solid rgba(16,185,129,0.35)",
    };
  } else if (normalized === "skipped") {
    style = {
      background: "rgba(245,158,11,0.16)",
      color: "#fde68a",
      border: "1px solid rgba(245,158,11,0.35)",
    };
  } else if (normalized === "needs_review") {
    style = {
      background: "rgba(249,115,22,0.16)",
      color: "#fdba74",
      border: "1px solid rgba(249,115,22,0.35)",
    };
  } else if (normalized === "failed") {
    style = {
      background: "rgba(239,68,68,0.16)",
      color: "#fca5a5",
      border: "1px solid rgba(239,68,68,0.35)",
    };
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {value}
    </span>
  );
}

function DispositionPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();

  let style: React.CSSProperties = {
    background: "rgba(148,163,184,0.16)",
    color: "#cbd5e1",
    border: "1px solid rgba(148,163,184,0.35)",
  };

  if (normalized === "confirmed_match") {
    style = {
      background: "rgba(16,185,129,0.16)",
      color: "#86efac",
      border: "1px solid rgba(16,185,129,0.35)",
    };
  } else if (normalized === "outside_carrier") {
    style = {
      background: "rgba(245,158,11,0.16)",
      color: "#fde68a",
      border: "1px solid rgba(245,158,11,0.35)",
    };
  } else if (normalized === "unresolved") {
    style = {
      background: "rgba(239,68,68,0.16)",
      color: "#fca5a5",
      border: "1px solid rgba(239,68,68,0.35)",
    };
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {value}
    </span>
  );
}

export default function InboundHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<HistoryResponse["summary"] | null>(null);
  const [customers, setCustomers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customer, setCustomer] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadData(
    nextStartDate?: string,
    nextEndDate?: string,
    nextCustomer?: string
  ) {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (nextStartDate) params.set("start_date", nextStartDate);
      if (nextEndDate) params.set("end_date", nextEndDate);
      if (nextCustomer) params.set("customer", nextCustomer);

      const url = `/api/inbound/history${
        params.toString() ? `?${params.toString()}` : ""
      }`;

      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as HistoryResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load history");
      }

      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setCustomers(data.customers ?? []);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

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
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 36, marginBottom: 8, color: "#f8fafc" }}>
            Inbound History
          </h1>
          <p style={{ margin: 0, color: "#94a3b8" }}>
            Review inbound history by date range, customer, totals, and match percentages.
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
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <div style={{ marginBottom: 6, color: "#cbd5e1", fontSize: 13 }}>
                Start Date
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <div style={{ marginBottom: 6, color: "#cbd5e1", fontSize: 13 }}>
                End Date
              </div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <div style={{ marginBottom: 6, color: "#cbd5e1", fontSize: 13 }}>
                Customer
              </div>
              <select
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => loadData(startDate, endDate, customer)}
              style={primaryButtonStyle}
            >
              {loading ? "Loading..." : "Filter"}
            </button>

            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setCustomer("");
                loadData();
              }}
              style={secondaryButtonStyle}
            >
              Reset
            </button>
          </div>
        </section>

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
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <StatCard
              label="Total Rows Showing"
              value={summary?.totalRows ?? rows.length}
            />
            <StatCard
              label="SCM Trucked"
              value={summary?.matchedTotal ?? 0}
              tone="success"
              subtext={`${summary?.matchedPct ?? 0}% of classified`}
            />
            <StatCard
              label="Outside Carrier"
              value={summary?.outsideCarrierTotal ?? 0}
              tone="warning"
              subtext={`${summary?.outsideCarrierPct ?? 0}% of classified`}
            />
            <StatCard
              label="Unresolved"
              value={summary?.unresolvedTotal ?? 0}
              tone="danger"
            />
            <StatCard
              label="Classified Total"
              value={summary?.classifiedTotal ?? 0}
            />
          </div>
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
          <h2 style={{ marginTop: 0, color: "#f8fafc" }}>Detailed History</h2>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 1350,
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Mark</th>
                  <th style={thStyle}>Shipper</th>
                  <th style={thStyle}>Bales</th>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Disposition</th>
                  <th style={thStyle}>Matched Order</th>
                  <th style={thStyle}>Seen Count</th>
                  <th style={thStyle}>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.received_date || "-"}</td>
                    <td style={tdStyle}>{row.mark || "-"}</td>
                    <td style={tdStyle}>{row.shipper || "-"}</td>
                    <td style={tdStyle}>{row.bale_count ?? "-"}</td>
                    <td style={tdStyle}>{row.location || "-"}</td>
                    <td style={tdStyle}>
                      <StatusPill value={row.status} />
                    </td>
                    <td style={tdStyle}>
                      <DispositionPill
                        value={row.derivedDisposition || row.disposition || "-"}
                      />
                    </td>
                    <td style={tdStyle}>{row.matched_order_id || "-"}</td>
                    <td style={tdStyle}>{row.seen_count ?? 1}</td>
                    <td style={tdStyle}>
                      {row.last_seen_at
                        ? new Date(row.last_seen_at).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(15,23,42,0.8)",
  color: "#e2e8f0",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(59,130,246,0.45)",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(15,23,42,0.8)",
  color: "#e2e8f0",
  cursor: "pointer",
  fontWeight: 700,
};

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