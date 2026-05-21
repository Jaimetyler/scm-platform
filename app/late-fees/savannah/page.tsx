"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function SavannahLateFeesPage() {
  return (
    <OfficeLateFeesPage
      officeTitle="Savannah Office"
      apiPath="/api/late-fees/savannah"
    />
  );
}

type LateFeeRow = {
  orderId: string;

  customerId: string;
  revenueCode: string;

  blnum: string;
  mark: string | null;

  bales: number;

  movementStatus: string;
  brokerageStatus: string;
  orderStatus: string;

  docCutoffDate: string | null;

  lastFreeDate: string | null;
  feeStartDate: string | null;

  rawDaysLate: number;
  graceDays: number;
  effectiveDaysLate: number;

  lateFee: number;

  policyCode: string | null;
  policyType: string | null;
  policyAmount: number | null;

  puLocationId: string | null;
  puCity: string | null;
  puState: string | null;

  soLocationId: string | null;
  soCity: string | null;
  soState: string | null;
};

type ApiResponse = {
  ok: boolean;
  count?: number;
  rows?: LateFeeRow[];
  note?: string;
  error?: string;
};

function OfficeLateFeesPage({
  officeTitle,
  apiPath,
}: {
  officeTitle: string;
  apiPath: string;
}) {
  const [rows, setRows] = useState<LateFeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(apiPath, {
  cache: "no-store",
});

        const data = (await res.json()) as ApiResponse;

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to load late fees");
        }

        if (!active) return;

        setRows(data.rows ?? []);
        setNote(data.note ?? null);
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error ? err.message : "Failed to load"
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [apiPath]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return rows;

    return rows.filter((row) =>
      [
        row.orderId,
        row.blnum,
        row.customerId,
        row.mark ?? "",
        row.policyCode ?? "",
        row.puLocationId ?? "",
        row.puCity ?? "",
        row.puState ?? "",
        row.soLocationId ?? "",
        row.soCity ?? "",
        row.soState ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.loads += 1;
        acc.bales += row.bales;
        acc.exposure += row.lateFee;
        return acc;
      },
      {
        loads: 0,
        bales: 0,
        exposure: 0,
      }
    );
  }, [filteredRows]);

  return (
    <main
      style={{
        maxWidth: 1600,
        margin: "0 auto",
        padding: "24px 20px 40px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid rgba(34,211,238,0.22)",
            background: "rgba(34,211,238,0.08)",
            color: "#67e8f9",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          SCM Platform
        </div>

        <Link
          href="/late-fees"
          style={{
            marginLeft: "auto",
            textDecoration: "none",
            color: "#e5e7eb",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          Back to Late Fees
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            color: "#f8fafc",
          }}
        >
          {officeTitle}
        </h1>

        <p
          style={{
            margin: "8px 0 0",
            color: "#94a3b8",
          }}
        >
          Current late-fee exposure on active loads.
        </p>
      </div>

      {note ? (
        <div
          style={{
            marginBottom: 18,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(250,204,21,0.20)",
            background: "rgba(250,204,21,0.08)",
            color: "#fde68a",
          }}
        >
          {note}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <StatCard
          label="Loads"
          value={String(totals.loads)}
        />

        <StatCard
          label="Bales"
          value={String(totals.bales)}
        />

        <StatCard
          label="Exposure"
          value={`$${totals.exposure.toFixed(2)}`}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, mark, customer, city, policy..."
          style={{
            width: "100%",
            maxWidth: 520,
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid rgba(148,163,184,0.2)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        />
      </div>

      <div
        style={{
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 16,
          overflow: "hidden",
          background: "rgba(15,23,42,0.75)",
        }}
      >
        {loading ? (
          <div
            style={{
              padding: 18,
              color: "#94a3b8",
            }}
          >
            Loading late fees...
          </div>
        ) : error ? (
          <div
            style={{
              padding: 18,
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 1500,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "rgba(30,41,59,0.9)",
                  }}
                >
                  {[
                    "Order",
                    "Mark",
                    "Customer",
                    "PU",
                    "PU City",
                    "SO",
                    "SO City",
                    "Bales",
                    "Move",
                    "Brokerage",
                    "Cutoff",
                    "Grace",
                    "Late",
                    "Rate",
                    "Fee",
                  ].map((head) => (
                    <th
                      key={head}
                      style={{
                        textAlign: "left",
                        padding: "12px 14px",
                        fontSize: 12,
                        color: "#cbd5e1",
                        borderBottom:
                          "1px solid rgba(148,163,184,0.14)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.orderId}
                    style={{
                      borderBottom:
                        "1px solid rgba(148,163,184,0.08)",
                    }}
                  >
                    <Cell>{row.orderId}</Cell>

                    <Cell>{row.mark ?? ""}</Cell>

                    <Cell>{row.customerId}</Cell>

                    <Cell>{row.puLocationId ?? ""}</Cell>

                    <Cell>
                      {row.puCity ?? ""}{" "}
                      {row.puState ?? ""}
                    </Cell>

                    <Cell>{row.soLocationId ?? ""}</Cell>

                    <Cell>
                      {row.soCity ?? ""}{" "}
                      {row.soState ?? ""}
                    </Cell>

                    <Cell>{row.bales}</Cell>

                    <Cell>{row.movementStatus}</Cell>

                    <Cell>{row.brokerageStatus}</Cell>

                    <Cell>{row.docCutoffDate ?? ""}</Cell>

                    <Cell>{row.graceDays}</Cell>

                    <Cell>{row.effectiveDaysLate}</Cell>

                    <Cell>
                      $
                      {(row.policyAmount ?? 0).toFixed(2)}
                    </Cell>

                    <Cell>
                      <span
                        style={{
                          color:
                            row.lateFee > 0
                              ? "#fca5a5"
                              : "#86efac",
                          fontWeight: 700,
                        }}
                      >
                        ${row.lateFee.toFixed(2)}
                      </span>
                    </Cell>
                  </tr>
                ))}

                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={15}
                      style={{
                        padding: 18,
                        color: "#94a3b8",
                      }}
                    >
                      No late-fee rows yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,0.14)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(15,23,42,0.72)",
      }}
    >
      <div
        style={{
          color: "#94a3b8",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 8,
          color: "#f8fafc",
          fontSize: 28,
          fontWeight: 800,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Cell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <td
      style={{
        padding: "12px 14px",
        color: "#e2e8f0",
        fontSize: 14,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}