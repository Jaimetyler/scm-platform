"use client";

import { useState } from "react";
import styles from "./workload-charts.module.css";

type Row = {
  month: string;
  code: string;
  person: string;
  customer: string;
  loads: number;
  revenue: number;
  margin: number;
};

type Metric = "loads" | "margin" | "revenue" | "perLoad";

type Props = {
  rows: Row[];
  scope: string;
  code: string;
  customer: string;
  person: string;
  onSelect: (name: string) => void;
};

const months = [
  "Sep", "Oct", "Nov", "Dec", "Jan", "Feb",
  "Mar", "Apr", "May", "Jun", "Jul", "Aug",
];

const metricLabels: Record<Metric, string> = {
  loads: "Loads",
  margin: "Gross margin",
  revenue: "Revenue",
  perLoad: "Margin per load",
};

const isSystem = (name: string) =>
  ["scmapi", "(unassigned)"].includes(name.toLowerCase());

function format(value: number, metric: Metric, compact = false) {
  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-US", {
    ...(metric === "loads"
      ? {}
      : { style: "currency", currency: "USD" }),
    notation: compact ? "compact" : "standard",
    maximumFractionDigits:
      metric === "perLoad" ? 2 : compact ? 1 : 0,
  }).format(value);
}

function metricValue(rows: Row[], metric: Metric) {
  const loads = rows.reduce((sum, row) => sum + row.loads, 0);
  const margin = rows.reduce(
    (sum, row) => sum + row.margin / 100,
    0,
  );

  if (metric === "loads") return loads;
  if (metric === "margin") return margin;
  if (metric === "perLoad") return loads ? margin / loads : NaN;

  return rows.reduce((sum, row) => sum + row.revenue / 100, 0);
}

function yearRows(rows: Row[], year: number) {
  return rows.filter(
    (row) =>
      row.month >= `${year}-09` &&
      row.month <= `${year + 1}-08`,
  );
}

function monthlyValues(rows: Row[], year: number, metric: Metric) {
  return months.map((_, index) => {
    const month = ((index + 8) % 12) + 1;
    const calendarYear = index < 4 ? year : year + 1;
    const key = `${calendarYear}-${String(month).padStart(2, "0")}`;

    return metricValue(
      rows.filter((row) => row.month === key),
      metric,
    );
  });
}

export default function WorkloadCharts({
  rows,
  scope,
  code,
  customer,
  person,
  onSelect,
}: Props) {
  const [metric, setMetric] = useState<Metric>("loads");
  const [compareWith, setCompareWith] = useState("");
  const [comparisonYear, setComparisonYear] = useState(2025);

  const codes =
    scope === "primary"
      ? ["MAIN", "CNTR", "TERRY", "DDRAY", "DAVIS"]
      : ["LOCAL", "HLOCAL", "DLOCAL"];

  const scopedRows = rows.filter(
    (row) =>
      codes.includes(row.code) &&
      (!code || row.code === code) &&
      row.month >= "2024-09" &&
      row.month <= "2026-08",
  );

  // Preserve the roster when a customer has no activity for a dispatcher.
  const roster = [
    ...new Set(
      scopedRows
        .filter((row) => !isSystem(row.person))
        .map((row) => row.person),
    ),
  ].sort();

  const filtered = scopedRows.filter(
    (row) => !customer || row.customer === customer,
  );

  const selectedPerson = scope === "primary" ? person : "";

  const comparing =
    Boolean(selectedPerson) &&
    Boolean(compareWith) &&
    selectedPerson !== compareWith &&
    roster.includes(compareWith);

  const selectedRows = selectedPerson
    ? filtered.filter((row) => row.person === selectedPerson)
    : filtered;

  const comparisonRows = comparing
    ? filtered.filter((row) => row.person === compareWith)
    : [];

  const firstYear = comparing ? comparisonYear : 2024;
  const secondYear = comparing ? comparisonYear : 2025;

  const first = monthlyValues(selectedRows, firstYear, metric);
  const second = monthlyValues(
    comparing ? comparisonRows : selectedRows,
    secondYear,
    metric,
  );

  const firstTotal = metricValue(
    yearRows(selectedRows, firstYear),
    metric,
  );
  const secondTotal = metricValue(
    yearRows(comparing ? comparisonRows : selectedRows, secondYear),
    metric,
  );

  const firstLabel = comparing
    ? selectedPerson
    : "Year 1 · Sep 2024–Aug 2025";
  const secondLabel = comparing
    ? compareWith
    : "Year 2 · Sep 2025–Aug 2026";

  const overallLabel =
    scope === "primary" ? "Overall brokerage" : "Overall local operations";

  const title = comparing
    ? `${selectedPerson} vs. ${compareWith}`
    : selectedPerson || overallLabel;

  const values = [...first, ...second].filter(Number.isFinite);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const padding = Math.max((high - low) * 0.1, 1);
  const minimum = low < 0 ? low - padding : 0;
  const maximum = high + padding;

  const width = 900;
  const height = 300;
  const left = 80;
  const right = 24;
  const top = 20;
  const bottom = 40;

  const x = (index: number) =>
    left + (index * (width - left - right)) / 11;

  const y = (value: number) =>
    top +
    ((maximum - value) / (maximum - minimum)) *
      (height - top - bottom);

  function path(points: number[]) {
    let connected = false;

    return points
      .map((value, index) => {
        if (!Number.isFinite(value)) {
          connected = false;
          return "";
        }

        const command = connected ? "L" : "M";
        connected = true;
        return `${command}${x(index)},${y(value)}`;
      })
      .join(" ");
  }

  const lines = [
    {
      label: firstLabel,
      points: first,
      color: "#5176c5",
      dashed: true,
    },
    {
      label: secondLabel,
      points: second,
      color: "#008b82",
      dashed: false,
    },
  ];

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <h2>Workload comparison</h2>
          <p>
            {comparing
              ? `Same-year comparison · September ${comparisonYear}–August ${comparisonYear + 1}`
              : "Year-over-year comparison · September through August"}
          </p>
        </div>
      </div>

      <div className={styles.heading}>
        {scope === "primary" && (
          <>
            <label>
              Dispatcher
              <select
                value={selectedPerson}
                onChange={(event) => {
                  onSelect(event.target.value);
                  setCompareWith("");
                }}
              >
                <option value="">Overall brokerage</option>
                {roster.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Compare with
              <select
                value={comparing ? compareWith : ""}
                disabled={!selectedPerson}
                onChange={(event) => setCompareWith(event.target.value)}
              >
                <option value="">Their previous year</option>
                {roster
                  .filter((name) => name !== selectedPerson)
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}

        {comparing && (
          <label>
            Comparison year
            <select
              value={comparisonYear}
              onChange={(event) =>
                setComparisonYear(Number(event.target.value))
              }
            >
              <option value={2024}>Year 1 · Sep 2024–Aug 2025</option>
              <option value={2025}>Year 2 · Sep 2025–Aug 2026</option>
            </select>
          </label>
        )}

        <label>
          Metric
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
          >
            {Object.entries(metricLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className={styles.note}>
        Charts follow operations, revenue-code, and customer filters.
        They use full business years, independently of the date controls
        above. Comparing a coworker changes only the chart; the summary
        and customer table remain tied to the primary dispatcher.
      </p>

      {customer && (
        <p className={styles.note}>
          Customer filter: <strong>{customer}</strong>. Both lines show
          activity for this customer only.
        </p>
      )}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <h3>{title}</h3>
        </div>

        <p className={styles.totals}>
          {firstLabel}: <strong>{format(firstTotal, metric)}</strong>
          {" · "}
          {secondLabel}: <strong>{format(secondTotal, metric)}</strong>
        </p>

        <div className={styles.legend}>
          <span className={styles.first}>{firstLabel} · dashed</span>
          <span className={styles.second}>{secondLabel} · solid</span>
        </div>

        <svg
          className={styles.svg}
          style={{ maxHeight: 380 }}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}: ${metricLabels[metric]}`}
        >
          <title>
            {title} — {metricLabels[metric]}
          </title>
          <desc>
            Blue dashed line: {firstLabel}. Teal solid line: {secondLabel}.
            Exact values are available in the monthly table below.
          </desc>

          {Array.from({ length: 5 }, (_, index) => {
            const value = minimum + ((maximum - minimum) * index) / 4;

            return (
              <g key={index}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#e1e8ee"
                />
                <text
                  x={left - 10}
                  y={y(value) + 4}
                  textAnchor="end"
                  fill="#5e7282"
                  fontSize="12"
                >
                  {format(value, metric, true)}
                </text>
              </g>
            );
          })}

          {minimum < 0 && (
            <line
              x1={left}
              x2={width - right}
              y1={y(0)}
              y2={y(0)}
              stroke="#8799a6"
              strokeDasharray="4 4"
            />
          )}

          {months.map((month, index) => (
            <text
              key={month}
              x={x(index)}
              y={height - 12}
              textAnchor="middle"
              fontSize="12"
              fill="#5e7282"
            >
              {month}
            </text>
          ))}

          {lines.map((line) => (
            <g key={line.label}>
              <path
                d={path(line.points)}
                fill="none"
                stroke={line.color}
                strokeWidth="3"
                strokeDasharray={line.dashed ? "7 5" : undefined}
              />
              {line.points.map(
                (value, index) =>
                  Number.isFinite(value) && (
                    <circle
                      key={index}
                      cx={x(index)}
                      cy={y(value)}
                      r="4"
                      fill={line.color}
                    >
                      <title>
                        {months[index]} · {line.label}:{" "}
                        {format(value, metric)}
                      </title>
                    </circle>
                  ),
              )}
            </g>
          ))}
        </svg>

        {!selectedRows.length && (
          <p className={styles.note}>
            No included activity for the primary selection.
          </p>
        )}

        {comparing && !comparisonRows.length && (
          <p className={styles.note}>
            No included activity for {compareWith} under these filters.
          </p>
        )}

        <details>
          <summary>Monthly values</summary>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>{firstLabel}</th>
                <th>{secondLabel}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month, index) => (
                <tr key={month}>
                  <td>{month}</td>
                  <td>{format(first[index], metric)}</td>
                  <td>{format(second[index], metric)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </article>

      <p className={styles.note}>
        {scope === "local"
          ? "Local imports are shown as operational activity, not employee workload. "
          : "Overall totals include system/unassigned activity; dispatcher selections exclude those accounts. "}
        Zero means no included activity, not verified idle time. Margin
        per load uses total margin divided by total loads; months with no
        loads appear as gaps.
      </p>
    </section>
  );
}
