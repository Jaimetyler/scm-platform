"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

type EquipmentSummary = {
  vanRows: number;
  flatRows: number;
  vanBales: number;
  flatBales: number;
  vanPct: number;
  flatPct: number;
};

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
  derivedDisposition?: string;
  seen_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  outcome?: string;
};

type HistoryResponse = {
  ok: boolean;
  summary?: {
    totalRows: number;
    matchedTotal: number;
    outsideCarrierTotal: number;
    totalBales: number;
    equipmentSummary: EquipmentSummary;
  };
  customers?: string[];
  rows?: HistoryRow[];
  error?: string;
};

type DisplayHistoryRow = HistoryRow & {
  outcome: string;
};

type SortKey =
  | "received_date"
  | "mark"
  | "shipper"
  | "terminal"
  | "equipment_type"
  | "bale_count"
  | "location"
  | "matched_order_id"
  | "outcome";

type SortDirection = "asc" | "desc";

function StatCard(props: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "danger" | "warning";
  subtext?: string;
  children?: React.ReactNode;
  valueFontSize?: number;
}) {
  const {
    label,
    value,
    tone = "default",
    subtext,
    children,
    valueFontSize = 34,
  } = props;

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
      <div
        style={{
          fontSize: valueFontSize,
          fontWeight: 800,
          lineHeight: 1,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      {subtext ? (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>{subtext}</div>
      ) : null}
      {children ? <div style={{ marginTop: 14 }}>{children}</div> : null}
    </div>
  );
}

function getOutcome(row: HistoryRow) {
  if (row.outcome && String(row.outcome).trim()) {
    const direct = String(row.outcome).trim();
    if (direct === "already_delivered") return "Already Delivered";
    if (direct === "matched") return "Processed";
    if (direct === "outside_carrier") return "Outside Carrier";
    if (direct === "needs_review") return "Needs Review";
    if (direct === "failed") return "Failed";
    if (direct === "skipped") return "Skipped";
    if (direct === "unknown") return "Unknown";
    return direct;
  }

  const rawStatus = String(row.status ?? "").toLowerCase();
  const rawReason = String(row.reason ?? "").toLowerCase();
  const rawDisposition = String(
    row.derivedDisposition || row.disposition || ""
  ).toLowerCase();

  if (rawStatus === "skipped" && rawReason.includes("delivered")) {
    return "Already Delivered";
  }

  if (rawDisposition === "confirmed_match" || rawStatus === "processed") {
    return "Processed";
  }

  if (rawDisposition === "outside_carrier") {
    return "Outside Carrier";
  }

  if (rawStatus === "needs_review") {
    return "Needs Review";
  }

  if (rawStatus === "skipped") {
    return "Skipped";
  }

  if (rawStatus === "failed") {
    return "Failed";
  }

  return row.status || "Unknown";
}

function OutcomePill({ value }: { value: string }) {
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
  } else if (normalized === "outside carrier") {
    style = {
      background: "rgba(245,158,11,0.16)",
      color: "#fde68a",
      border: "1px solid rgba(245,158,11,0.35)",
    };
  } else if (normalized === "already delivered") {
    style = {
      background: "rgba(59,130,246,0.16)",
      color: "#93c5fd",
      border: "1px solid rgba(59,130,246,0.35)",
    };
  } else if (normalized === "needs review") {
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
  } else if (normalized === "skipped") {
    style = {
      background: "rgba(148,163,184,0.16)",
      color: "#cbd5e1",
      border: "1px solid rgba(148,163,184,0.35)",
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
        whiteSpace: "normal",
        textAlign: "center",
        lineHeight: 1.2,
        ...style,
      }}
    >
      {value}
    </span>
  );
}

function EquipmentMixCard({ summary }: { summary: EquipmentSummary | undefined }) {
  const vanPct = summary?.vanPct ?? 0;
  const flatPct = summary?.flatPct ?? 0;
  const vanRows = summary?.vanRows ?? 0;
  const flatRows = summary?.flatRows ?? 0;
  const vanBales = summary?.vanBales ?? 0;
  const flatBales = summary?.flatBales ?? 0;

  return (
    <StatCard
      label="Equipment Mix"
      value={`${vanPct}% V / ${flatPct}% F`}
      valueFontSize={24}
      subtext={`Van: ${vanRows} rows • Flatbed: ${flatRows} rows`}
    >
      <div
        style={{
          width: "100%",
          height: 12,
          borderRadius: 999,
          overflow: "hidden",
          background: "rgba(148,163,184,0.14)",
          display: "flex",
          border: "1px solid rgba(148,163,184,0.15)",
        }}
      >
        <div
          style={{
            width: `${vanPct}%`,
            background: "rgba(16,185,129,0.75)",
          }}
        />
        <div
          style={{
            width: `${flatPct}%`,
            background: "rgba(245,158,11,0.75)",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 10,
          fontSize: 12,
          opacity: 0.9,
          flexWrap: "wrap",
        }}
      >
        <span>V Bales: {vanBales.toLocaleString()}</span>
        <span>F Bales: {flatBales.toLocaleString()}</span>
      </div>
    </StatCard>
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

function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function update() {
      if (typeof window === "undefined") return;
      setIsMobile(window.innerWidth <= breakpoint);
    }

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [breakpoint]);

  return isMobile;
}

function MobileHistoryCard({ row }: { row: DisplayHistoryRow }) {
  return (
    <div style={mobileCardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={mobileCardLabelStyle}>Mark</div>
          <div style={mobileCardPrimaryValueStyle}>{row.mark || "-"}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <OutcomePill value={row.outcome} />
        </div>
      </div>

      <div style={mobileGridStyle}>
        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Date</div>
          <div style={mobileCardValueStyle}>{row.received_date || "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Shipper</div>
          <div style={mobileCardValueStyle}>{row.shipper || "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Terminal</div>
          <div style={mobileCardValueStyle}>{row.terminal || "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Equipment</div>
          <div style={mobileCardValueStyle}>{row.equipment_type || "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Bales</div>
          <div style={mobileCardValueStyle}>{row.bale_count ?? "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Location</div>
          <div style={mobileCardValueStyle}>{row.location || "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Matched Order</div>
          <div style={mobileCardValueStyle}>{row.matched_order_id || "-"}</div>
        </div>

        <div style={mobileFieldStyle}>
          <div style={mobileCardLabelStyle}>Outcome</div>
          <div style={mobileCardValueStyle}>{row.outcome}</div>
        </div>
      </div>
    </div>
  );
}

export default function InboundHistoryPage() {
  const isMobile = useIsMobile(900);

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<HistoryResponse["summary"] | null>(null);
  const [customers, setCustomers] = useState<string[]>([]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customer, setCustomer] = useState("");
  const [terminal, setTerminal] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [loading, setLoading] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("received_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [search]);

  async function loadData(
    nextStartDate = startDate,
    nextEndDate = endDate,
    nextCustomer = customer,
    nextTerminal = terminal,
    nextSearch = debouncedSearch
  ) {
    try {
      setLoading(true);

      const params = new URLSearchParams();

      if (nextStartDate) params.set("start_date", nextStartDate);
      if (nextEndDate) params.set("end_date", nextEndDate);
      if (nextCustomer) params.set("customer", nextCustomer);
      if (nextTerminal) params.set("terminal", nextTerminal);
      if (nextSearch) params.set("search", nextSearch);

      const url = `/api/inbound/history?${params.toString()}`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const displayRows = useMemo<DisplayHistoryRow[]>(() => {
    return rows.map((row) => ({
      ...row,
      outcome: getOutcome(row),
    }));
  }, [rows]);

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  const sortedRows = useMemo(() => {
    const copy = [...displayRows];
    copy.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDirection));
    return copy;
  }, [displayRows, sortKey, sortDirection]);

  function exportToExcel() {
    const exportRows = sortedRows.map((row) => ({
      "Received Date": row.received_date ?? "",
      Mark: row.mark ?? "",
      Shipper: row.shipper ?? "",
      Terminal: row.terminal ?? "",
      "Equipment Type": row.equipment_type ?? "",
      "Bale Count": row.bale_count ?? "",
      Location: row.location ?? "",
      Outcome: row.outcome ?? "",
      "Matched Order ID": row.matched_order_id ?? "",
      "First Seen": row.first_seen_at ?? "",
      "Last Seen": row.last_seen_at ?? "",
      "Seen Count": row.seen_count ?? "",
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
        subtitle="Review inbound history by date range, customer, terminal, and equipment mix."
        actions={
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              width: "100%",
              justifyContent: "flex-start",
            }}
          >
            <Link href="/" style={linkButtonStyle}>
              ← Back Home
            </Link>

            <Link href="/inbound" style={linkButtonStyle}>
              Back to Uploader
            </Link>

            <button onClick={exportToExcel} style={primaryButtonStyle}>
              Export to Excel
            </button>
          </div>
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
          <div style={{ minWidth: 280, flex: "1 1 320px" }}>
            <div style={labelStyle}>Search (Mark / Order #)</div>
            <input
              type="text"
              placeholder="Type mark or matched order number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 160, flex: "1 1 180px" }}>
            <div style={labelStyle}>Start Date</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 160, flex: "1 1 180px" }}>
            <div style={labelStyle}>End Date</div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 170, flex: "1 1 200px" }}>
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

          <div style={{ minWidth: 160, flex: "1 1 180px" }}>
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

          <button
            type="button"
            onClick={() => {
              loadData(startDate, endDate, customer, terminal, debouncedSearch);
            }}
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
              setSearch("");
              setRows([]);
              loadData("", "", "", "", "");
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
          <StatCard label="Total Rows" value={summary?.totalRows ?? 0} />
          <StatCard
            label="Processed"
            value={summary?.matchedTotal ?? 0}
            tone="success"
          />
          <StatCard
            label="Outside Carrier"
            value={summary?.outsideCarrierTotal ?? 0}
            tone="warning"
          />
          <StatCard
            label="Total Bales"
            value={(summary?.totalBales ?? 0).toLocaleString()}
          />
          <EquipmentMixCard summary={summary?.equipmentSummary} />
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

        {isMobile ? (
          <div style={{ display: "grid", gap: 14 }}>
            {sortedRows.map((row) => (
              <MobileHistoryCard key={row.id} row={row} />
            ))}

            {sortedRows.length === 0 ? (
              <div
                style={{
                  padding: "28px 18px",
                  textAlign: "center",
                  color: "#94a3b8",
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.14)",
                  background: "rgba(2,6,23,0.24)",
                }}
              >
                {loading
                  ? "Loading history..."
                  : "No history rows found for the selected filters."}
              </div>
            ) : null}
          </div>
        ) : (
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
                minWidth: 900,
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
                  <th style={thStyle}>{renderSortableHeader("Outcome", "outcome")}</th>
                  <th style={thStyle}>
                    {renderSortableHeader("Matched Order", "matched_order_id")}
                  </th>
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
                      <OutcomePill value={row.outcome} />
                    </td>
                    <td style={tdStyle}>{row.matched_order_id || "-"}</td>
                  </tr>
                ))}

                {sortedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        padding: "28px 18px",
                        textAlign: "center",
                        color: "#94a3b8",
                      }}
                    >
                      {loading
                        ? "Loading history..."
                        : "No history rows found for the selected filters."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
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
  width: "auto",
  flex: "0 0 auto",
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
  width: "auto",
  flex: "0 0 auto",
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
  padding: "12px 14px",
  verticalAlign: "middle",
  fontSize: 12,
  color: "#94a3b8",
  whiteSpace: "nowrap",
  background: "rgba(15,23,42,0.94)",
  position: "sticky",
  top: 0,
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  padding: "14px 14px",
  verticalAlign: "top",
  color: "#e5e7eb",
  whiteSpace: "normal",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

const trStyle: React.CSSProperties = {
  background: "transparent",
};

const mobileCardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.24)",
  padding: 16,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};

const mobileGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const mobileFieldStyle: React.CSSProperties = {
  minWidth: 0,
};

const mobileCardLabelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const mobileCardPrimaryValueStyle: React.CSSProperties = {
  color: "#f8fafc",
  fontSize: 20,
  fontWeight: 800,
  lineHeight: 1.1,
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

const mobileCardValueStyle: React.CSSProperties = {
  color: "#e5e7eb",
  fontSize: 14,
  lineHeight: 1.35,
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};