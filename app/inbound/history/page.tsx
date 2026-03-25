"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

type HistoryRow = {
  id: string;
  received_date: string;
  mark: string;
  shipper: string;
  bale_count: number | null;
  location: string | null;
  source_sheet: string | null;
  terminal: string | null;
  equipment_type: string | null;
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
    terminal?: string | null;
    status?: string | null;
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

type SortKey =
  | "received_date"
  | "mark"
  | "shipper"
  | "terminal"
  | "equipment_type"
  | "bale_count"
  | "location"
  | "status"
  | "derivedDisposition"
  | "matched_order_id"
  | "reason";

type SortDirection = "asc" | "desc";

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
        borderRadius: 18,
        padding: 18,
        minHeight: 110,
        boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
        ...toneStyles[tone],
      }}
    >
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {subtext ? (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>{subtext}</div>
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
        padding: "6px 12px",
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
        padding: "6px 12px",
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

function compareValues(a: unknown, b: unknown, direction: SortDirection) {
  const dir = direction === "asc" ? 1 : -1;

  const aVal = a ?? "";
  const bVal = b ?? "";

  const aDate = typeof aVal === "string" ? Date.parse(aVal) : NaN;
  const bDate = typeof bVal === "string" ? Date.parse(bVal) : NaN;
  const bothDates = !Number.isNaN(aDate) && !Number.isNaN(bDate);

  if (bothDates) {
    return (aDate - bDate) * dir;
  }

  const aNum = typeof aVal === "number" ? aVal : Number(aVal);
  const bNum = typeof bVal === "number" ? bVal : Number(bVal);
  const bothNums = !Number.isNaN(aNum) && !Number.isNaN(bNum);

  if (bothNums) {
    return (aNum - bNum) * dir;
  }

  return String(aVal).localeCompare(String(bVal)) * dir;
}

export default function InboundHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<HistoryResponse["summary"] | null>(null);
  const [customers, setCustomers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customer, setCustomer] = useState("");
  const [terminal, setTerminal] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("received_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  async function loadData(
    nextStartDate?: string,
    nextEndDate?: string,
    nextCustomer?: string,
    nextTerminal?: string,
    nextStatus?: string
  ) {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (nextStartDate) params.set("start_date", nextStartDate);
      if (nextEndDate) params.set("end_date", nextEndDate);
      if (nextCustomer) params.set("customer", nextCustomer);
      if (nextTerminal) params.set("terminal", nextTerminal);
      if (nextStatus) params.set("status", nextStatus);

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

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDirection));
    return copy;
  }, [rows, sortKey, sortDirection]);

  function exportToExcel() {
    const exportRows = sortedRows.map((row) => ({
      "Received Date": row.received_date ?? "",
      Mark: row.mark ?? "",
      Shipper: row.shipper ?? "",
      Terminal: row.terminal ?? "",
      "Equipment Type": row.equipment_type ?? "",
      "Bale Count": row.bale_count ?? "",
      Location: row.location ?? "",
      Status: row.status ?? "",
      Disposition: row.derivedDisposition ?? row.disposition ?? "",
      "Matched Order ID": row.matched_order_id ?? "",
      Reason: row.reason ?? "",
      "First Seen": row.first_seen_at ?? "",
      "Source Sheet": row.source_sheet ?? "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inbound History");

    const fileSuffix = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `inbound-history-${fileSuffix}.xlsx`);
  }

  function renderSortableHeader(label: string, key: SortKey) {
    const active = sortKey === key;
    const arrow = active ? (sortDirection === "asc" ? " ▲" : " ▼") : "";

    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        style={{
          background: "transparent",
          border: "none",
          color: active ? "#e2e8f0" : "#94a3b8",
          cursor: "pointer",
          fontWeight: 700,
          padding: 0,
          fontSize: 13,
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {arrow}
      </button>
    );
  }

  return (
    <main style={{ maxWidth: 1560, margin: "0 auto" }}>
      <PlatformPageHeader
  title="Inbound History"
  subtitle="Review inbound history by date range, customer, terminal, status, totals, and match percentages."
  actions={
    <>
      <Link href="/" style={secondaryButtonStyle}>
        ← Back Home
      </Link>

      <Link href="/inbound" style={secondaryButtonStyle}>
        Back to Uploader
      </Link>

      <button onClick={exportToExcel} style={primaryButtonStyle}>
        Export to Excel
      </button>
    </>
  }
/>

      <PlatformPanel>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            alignItems: "end",
          }}
        >
          <div style={{ minWidth: 160 }}>
            <div style={labelStyle}>Start Date</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 160 }}>
            <div style={labelStyle}>End Date</div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 170 }}>
            <div style={labelStyle}>Customer</div>
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

          <div style={{ minWidth: 160 }}>
            <div style={labelStyle}>Terminal</div>
            <select
              value={terminal}
              onChange={(e) => setTerminal(e.target.value)}
              style={inputStyle}
            >
              <option value="">All Terminals</option>
              <option value="SAV">Savannah</option>
              <option value="HOU">Houston</option>
            </select>
          </div>

          <div style={{ minWidth: 160 }}>
            <div style={labelStyle}>Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={inputStyle}
            >
              <option value="">All Status</option>
              <option value="processed">processed</option>
              <option value="skipped">skipped</option>
              <option value="failed">failed</option>
              <option value="needs_review">needs_review</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => loadData(startDate, endDate, customer, terminal, status)}
            style={primaryButtonStyle}
          >
            {loading ? "Loading..." : "Filter"}
          </button>

          <button
            type="button"
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setCustomer("");
              setTerminal("");
              setStatus("");
              loadData();
            }}
            style={secondaryButtonStyle}
          >
            Reset
          </button>
        </div>
      </PlatformPanel>

      <PlatformPanel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
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
      </PlatformPanel>

      <PlatformPanel>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#f8fafc",
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            Detailed History
          </h2>

          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            {sortedRows.length} row{sortedRows.length === 1 ? "" : "s"}
          </div>
        </div>

        <div
          style={{
            overflowX: "auto",
            borderRadius: 16,
            border: "1px solid rgba(148,163,184,0.14)",
            background: "rgba(2,6,23,0.24)",
          }}
        >
          <table
            style={{
              width: "100%",
              minWidth: 1400,
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>{renderSortableHeader("Date", "received_date")}</th>
                <th style={thStyle}>{renderSortableHeader("Mark", "mark")}</th>
                <th style={thStyle}>{renderSortableHeader("Shipper", "shipper")}</th>
                <th style={thStyle}>{renderSortableHeader("Terminal", "terminal")}</th>
                <th style={thStyle}>{renderSortableHeader("Equip", "equipment_type")}</th>
                <th style={thStyle}>{renderSortableHeader("Bales", "bale_count")}</th>
                <th style={thStyle}>{renderSortableHeader("Location", "location")}</th>
                <th style={thStyle}>{renderSortableHeader("Status", "status")}</th>
                <th style={thStyle}>
                  {renderSortableHeader("Disposition", "derivedDisposition")}
                </th>
                <th style={thStyle}>
                  {renderSortableHeader("Matched Order", "matched_order_id")}
                </th>
                <th style={thStyle}>{renderSortableHeader("Reason", "reason")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} style={trStyle}>
                  <td style={tdStyle}>{row.received_date || "-"}</td>
                  <td style={tdStyle}>{row.mark || "-"}</td>
                  <td style={tdStyle}>{row.shipper || "-"}</td>
                  <td style={tdStyle}>{row.terminal || "-"}</td>
                  <td style={tdStyle}>{row.equipment_type || "-"}</td>
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
                  <td style={tdStyle}>{row.reason || "-"}</td>
                </tr>
              ))}

              {sortedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    style={{
                      padding: "28px 18px",
                      textAlign: "center",
                      color: "#94a3b8",
                      whiteSpace: "nowrap",
                    }}
                  >
                    No history rows found for the selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PlatformPanel>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  marginBottom: 7,
  color: "#cbd5e1",
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(15,23,42,0.82)",
  color: "#e2e8f0",
  width: "100%",
  minHeight: 46,
};

const primaryButtonStyle: React.CSSProperties = {
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

const secondaryButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(15,23,42,0.84)",
  color: "#e2e8f0",
  cursor: "pointer",
  fontWeight: 800,
  minHeight: 46,
};

const linkButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(15,23,42,0.84)",
  color: "#e2e8f0",
  cursor: "pointer",
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid rgba(148,163,184,0.16)",
  padding: "16px 18px",
  verticalAlign: "middle",
  fontSize: 13,
  color: "#94a3b8",
  whiteSpace: "nowrap",
  background: "rgba(15,23,42,0.94)",
  position: "sticky",
  top: 0,
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  padding: "18px 18px",
  verticalAlign: "middle",
  color: "#e5e7eb",
  whiteSpace: "nowrap",
};

const trStyle: React.CSSProperties = {
  background: "transparent",
};