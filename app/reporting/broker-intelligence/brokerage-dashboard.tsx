"use client";

import { useState } from "react";
import WorkloadCharts from "./workload-charts";
import styles from "./brokerage.module.css";

type Row = {
  month: string;
  code: string;
  person: string;
  customer: string;
  name: string;
  loads: number;
  revenue: number;
  pay: number;
  margin: number;
};

type Snapshot = {
  version: number;
  rows: Row[];
};

const primary = ["MAIN", "CNTR", "TERRY", "DDRAY", "DAVIS"];
const local = ["LOCAL", "HLOCAL", "DLOCAL"];

const system = (person: string) =>
  ["scmapi", "(unassigned)"].includes(person.toLowerCase());

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const number = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function totals(rows: Row[]) {
  return rows.reduce(
    (sum, row) => ({
      loads: sum.loads + row.loads,
      revenue: sum.revenue + row.revenue,
      pay: sum.pay + row.pay,
      margin: sum.margin + row.margin,
    }),
    { loads: 0, revenue: 0, pay: 0, margin: 0 },
  );
}

function grouped(rows: Row[], key: "person" | "customer") {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const value = row[key];
    const items = groups.get(value) ?? [];
    items.push(row);
    groups.set(value, items);
  }

  return [...groups]
    .map(([id, items]) => ({
      id,
      label: key === "customer" ? `${items[0].name} · ${id}` : id,
      ...totals(items),
    }))
    .sort((a, b) => b.loads - a.loads);
}

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;

  const data = value as Snapshot;

  return (
    data.version === 1 &&
    Array.isArray(data.rows) &&
    data.rows.length > 0 &&
    data.rows.every(
      (row) =>
        row &&
        typeof row === "object" &&
        [row.code, row.person, row.customer, row.name].every(
          (field) => typeof field === "string",
        ) &&
        typeof row.month === "string" &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) &&
        [row.loads, row.revenue, row.pay, row.margin].every((field) =>
          Number.isSafeInteger(field),
        ) &&
        row.loads >= 0,
    )
  );
}

export default function BrokerageDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("primary");
  const [start, setStart] = useState("2024-09");
  const [end, setEnd] = useState("2026-08");
  const [code, setCode] = useState("");
  const [person, setPerson] = useState("");
  const [customer, setCustomer] = useState("");

  async function openFile(file?: File) {
    if (!file) return;

    try {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error("Choose a snapshot smaller than 50 MB.");
      }

      const parsed: unknown = JSON.parse(await file.text());

      if (!validSnapshot(parsed)) {
        throw new Error("This is not a supported brokerage snapshot.");
      }

      setSnapshot(parsed);
      setPerson("");
      setCustomer("");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to read file.",
      );
    }
  }

  const codes = scope === "primary" ? primary : local;

  const dateValid =
    start >= "2024-09" &&
    end <= "2026-08" &&
    start <= end &&
    /^\d{4}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}$/.test(end);

  // Keep the dispatcher selector stable when changing date ranges.
  const scopeRows = (snapshot?.rows ?? []).filter(
    (row) =>
      codes.includes(row.code) &&
      row.month >= "2024-09" &&
      row.month <= "2026-08" &&
      (!code || row.code === code),
  );

  const people = [
    ...new Set(
      scopeRows
        .filter((row) => !system(row.person))
        .map((row) => row.person),
    ),
  ].sort();

  const selected = scopeRows.filter(
    (row) =>
      dateValid &&
      row.month >= start &&
      row.month <= end &&
      (!person || row.person === person) &&
      (!customer || row.customer === customer),
  );

  const summary = totals(selected);
  const staffRows = grouped(
    selected.filter((row) => !system(row.person)),
    "person",
  );
  const customers = grouped(selected, "customer");
  const systemTotals = totals(
    selected.filter((row) => system(row.person)),
  );

  function resetFilters() {
    setPerson("");
    setCustomer("");
    setCode("");
    setStart("2024-09");
    setEnd("2026-08");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SCM · Management</p>
          <h1>Broker Intelligence</h1>
          <p>
            Customer assignments, financial contribution, and seasonal
            demand.
          </p>
        </div>

        <label className={styles.upload}>
          Load historical snapshot
          <input
            type="file"
            accept=".json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void openFile(file);
            }}
          />
        </label>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {!snapshot ? (
        <section className={styles.panel}>
          <h2>Start with the historical data</h2>
          <p>
            Select SCM_Brokerage_Snapshot.json. This version keeps the
            snapshot in this browser tab; refreshing clears it.
          </p>
          <p>
            Coverage: September 2024–August 2026. Local imports and system
            accounts are separated from employee comparisons.
          </p>
        </section>
      ) : (
        <>
          <section className={styles.filters}>
            <label>
              Operations
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setCode("");
                  setPerson("");
                  setCustomer("");
                }}
              >
                <option value="primary">Primary brokerage</option>
                <option value="local">Local operations</option>
              </select>
            </label>

            <label>
              From
              <input
                type="month"
                min="2024-09"
                max="2026-08"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>

            <label>
              Through
              <input
                type="month"
                min="2024-09"
                max="2026-08"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>

            <label>
              Revenue code
              <select
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setPerson("");
                  setCustomer("");
                }}
              >
                <option value="">All selected codes</option>
                {codes.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>

            {scope === "primary" && (
              <label>
                Dispatcher
                <select
                  value={person}
                  onChange={(event) => setPerson(event.target.value)}
                >
                  <option value="">
                    All, including system financials
                  </option>
                  {people.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="button"
              onClick={() => {
                setStart("2024-09");
                setEnd("2025-08");
              }}
            >
              Year 1
            </button>

            <button
              type="button"
              onClick={() => {
                setStart("2025-09");
                setEnd("2026-08");
              }}
            >
              Year 2
            </button>

            <button type="button" onClick={resetFilters}>
              Reset filters
            </button>
          </section>

          {!dateValid && (
            <p role="alert" className={styles.error}>
              Choose a valid date range within September 2024–August
              2026. Annual charts below still show the two full years.
            </p>
          )}

          {(person || customer) && (
            <div className={styles.selection}>
              {person && (
                <button type="button" onClick={() => setPerson("")}>
                  Clear dispatcher: {person}
                </button>
              )}
              {customer && (
                <button type="button" onClick={() => setCustomer("")}>
                  Clear customer: {customer}
                </button>
              )}
            </div>
          )}

          <p className={styles.note}>
            Summary and tables: {start || "—"} through {end || "—"}
            {person ? ` · Dispatcher: ${person}` : " · All dispatchers"}
            {customer ? ` · Customer: ${customer}` : ""}
          </p>

          <section className={styles.cards}>
            {[
              ["Loads", number(summary.loads)],
              ["Revenue", money(summary.revenue)],
              ["Gross margin", money(summary.margin)],
              [
                "Margin / load",
                summary.loads
                  ? money(summary.margin / summary.loads)
                  : "—",
              ],
              [
                "Margin %",
                summary.revenue
                  ? percent(summary.margin / summary.revenue)
                  : "—",
              ],
            ].map(([label, value]) => (
              <div key={label} className={styles.card}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>

          <p className={styles.note}>
            {scope === "local"
              ? "Local activity is recorded through back-end imports. Importing usernames are not dispatch workload. Reported margin is not a fully costed asset P&L."
              : `Recorded dispatcher attribution, not measured labor hours. System/unassigned: ${number(systemTotals.loads)} loads and ${money(systemTotals.margin)} margin are included in the selected totals, but excluded from the people table.`}
            {" "}Gross margin is before overhead. Zero activity does not
            prove idle time or complete source coverage.
          </p>

          <WorkloadCharts
            rows={snapshot.rows}
            scope={scope}
            code={code}
            customer={customer}
            person={person}
            onSelect={setPerson}
          />

          {scope === "primary" && (
            <section className={styles.panel}>
              <h2>People</h2>
              <p>
                Selected date range. Select a dispatcher to see their
                customers and seasonal activity.
              </p>

              <div className={styles.scroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Dispatcher</th>
                      <th>Loads</th>
                      <th>Revenue</th>
                      <th>Gross margin</th>
                      <th>Margin / load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            onClick={() => setPerson(row.id)}
                          >
                            {row.label}
                          </button>
                        </td>
                        <td>{number(row.loads)}</td>
                        <td>{money(row.revenue)}</td>
                        <td>{money(row.margin)}</td>
                        <td>
                          {row.loads
                            ? money(row.margin / row.loads)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!staffRows.length && (
                <p>No employee-attributed activity matches these filters.</p>
              )}
            </section>
          )}

          <section className={styles.panel}>
            <h2>Customers</h2>
            <p>
              Selected date range. Select an account to see its
              dispatcher coverage and monthly volume.
            </p>

            <div className={styles.scroll}>
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Loads</th>
                    <th>Carrier pay</th>
                    <th>Gross margin</th>
                    <th>Share of selected loads</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => setCustomer(row.id)}
                        >
                          {row.label}
                        </button>
                      </td>
                      <td>{number(row.loads)}</td>
                      <td>{money(row.pay)}</td>
                      <td>{money(row.margin)}</td>
                      <td>
                        {summary.loads
                          ? percent(row.loads / summary.loads)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!selected.length && (
              <p>No activity matches these filters.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
