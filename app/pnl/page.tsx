"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";

type PnlRow = {
  report_month: string;
  entity: string;
  current_income: string | number | null;
  current_expense: string | number | null;
  current_net: string | number | null;
  ytd_income?: string | number | null;
  ytd_expense?: string | number | null;
  ytd_net?: string | number | null;
};

type DetailRow = {
  report_month: string;
  entity: string;
  section: string;
  account_number: string | null;
  description: string | null;
  current_period: string | number | null;
  year_to_date: string | number | null;
};

type ViewMode = "current" | "ytd";

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(asNumber(value));
}

function prettyMonth(value: string | null | undefined) {
  if (!value) return "No data";
  const d = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(d);
}

const entityOrder = [
  "Brokerage",
  "Savannah Warehouse",
  "Houston Warehouse",
  "Dallas Warehouse",
  "SCMI",
  "Other",
];

function netColor(value: number) {
  if (value < 0) return "text-rose-400";
  if (value > 0) return "text-emerald-400";
  return "text-neutral-200";
}

export default function PnlPage() {
  const [rows, setRows] = useState<PnlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<DetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("current");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  useEffect(() => {
    async function loadRows() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch("/api/pnl/summary", { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Failed to load P&L summary.");
        }

        const loadedRows = json.rows || [];
        setRows(loadedRows);

        if (loadedRows.length > 0) {
          setSelectedMonth(loadedRows[0].report_month);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }

    loadRows();
  }, []);

  const availableMonths = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.report_month))).filter(Boolean);
  }, [rows]);

  const activeMonth = selectedMonth || rows[0]?.report_month || "";

  const monthRows = useMemo(() => {
    return rows
      .filter((r) => r.report_month === activeMonth)
      .sort((a, b) => {
        const aIndex = entityOrder.indexOf(a.entity);
        const bIndex = entityOrder.indexOf(b.entity);
        const aRank = aIndex === -1 ? 999 : aIndex;
        const bRank = bIndex === -1 ? 999 : bIndex;
        return aRank - bRank;
      });
  }, [rows, activeMonth]);

  const totals = useMemo(() => {
    return monthRows.reduce(
      (acc, row) => {
        acc.currentIncome += asNumber(row.current_income);
        acc.currentExpense += asNumber(row.current_expense);
        acc.currentNet += asNumber(row.current_net);
        acc.ytdIncome += asNumber(row.ytd_income);
        acc.ytdExpense += asNumber(row.ytd_expense);
        acc.ytdNet += asNumber(row.ytd_net);
        return acc;
      },
      {
        currentIncome: 0,
        currentExpense: 0,
        currentNet: 0,
        ytdIncome: 0,
        ytdExpense: 0,
        ytdNet: 0,
      }
    );
  }, [monthRows]);

  useEffect(() => {
    setSelectedEntity(null);
    setDetailRows([]);
    setDetailLoading(false);
  }, [activeMonth]);

  async function handleEntityClick(entity: string) {
    if (!activeMonth) return;

    try {
      setSelectedEntity(entity);
      setDetailLoading(true);
      setError("");

      const params = new URLSearchParams({
        reportMonth: activeMonth,
        entity,
      });

      const res = await fetch(`/api/pnl/detail?${params.toString()}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Failed to load detail rows.");
      }

      setDetailRows(json.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load details.");
      setDetailRows([]);
    } finally {
      setDetailLoading(false);
    }
  }

  const detailTotals = useMemo(() => {
    return detailRows.reduce(
      (acc, row) => {
        if (row.section === "Income") {
          acc.currentIncome += asNumber(row.current_period);
          acc.ytdIncome += asNumber(row.year_to_date);
        }
        if (row.section === "Expense") {
          acc.currentExpense += asNumber(row.current_period);
          acc.ytdExpense += asNumber(row.year_to_date);
        }
        return acc;
      },
      {
        currentIncome: 0,
        currentExpense: 0,
        ytdIncome: 0,
        ytdExpense: 0,
      }
    );
  }, [detailRows]);

  function exportEntitySummary() {
    if (!monthRows.length) return;

    const data = monthRows.map((row) => ({
      "Report Month": prettyMonth(row.report_month),
      Entity: row.entity,
      "Current Income": asNumber(row.current_income),
      "Current Expense": asNumber(row.current_expense),
      "Current Net": asNumber(row.current_net),
      "YTD Income": asNumber(row.ytd_income),
      "YTD Expense": asNumber(row.ytd_expense),
      "YTD Net": asNumber(row.ytd_net),
    }));

    data.push({
      "Report Month": prettyMonth(activeMonth),
      Entity: "Total",
      "Current Income": totals.currentIncome,
      "Current Expense": totals.currentExpense,
      "Current Net": totals.currentNet,
      "YTD Income": totals.ytdIncome,
      "YTD Expense": totals.ytdExpense,
      "YTD Net": totals.ytdNet,
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!cols"] = [
      { wch: 18 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Entity Summary");

    XLSX.writeFile(
      workbook,
      `pnl-entity-summary-${activeMonth || "latest"}.xlsx`
    );
  }

  function exportDetailLines() {
    if (!selectedEntity || !detailRows.length) return;

    const data = detailRows.map((row) => ({
      "Report Month": prettyMonth(row.report_month),
      Entity: row.entity,
      Section: row.section,
      Account: row.account_number || "",
      Description: row.description || "",
      Current: asNumber(row.current_period),
      YTD: asNumber(row.year_to_date),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!cols"] = [
      { wch: 18 },
      { wch: 22 },
      { wch: 12 },
      { wch: 14 },
      { wch: 40 },
      { wch: 16 },
      { wch: 16 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Detail Lines");

    const safeEntity = selectedEntity.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    XLSX.writeFile(
      workbook,
      `pnl-detail-${safeEntity}-${activeMonth || "latest"}.xlsx`
    );
  }

  const metricLabel = viewMode === "current" ? "Current" : "YTD";

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 shadow-2xl">
          <div className="border-b border-white/10 px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-3 inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
                  SCM Platform
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Profit &amp; Loss Dashboard
                </h1>
                <p className="mt-3 text-sm text-neutral-400 sm:text-base">
                  Reporting month:{" "}
                  <span className="font-medium text-neutral-200">
                    {prettyMonth(activeMonth)}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={activeMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white outline-none transition hover:bg-white/10"
                >
                  {availableMonths.map((month) => (
                    <option key={month} value={month} className="bg-neutral-900">
                      {prettyMonth(month)}
                    </option>
                  ))}
                </select>

                <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode("current")}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      viewMode === "current"
                        ? "bg-cyan-400/15 text-cyan-300"
                        : "text-neutral-300 hover:bg-white/5"
                    }`}
                  >
                    Current
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("ytd")}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      viewMode === "ytd"
                        ? "bg-cyan-400/15 text-cyan-300"
                        : "text-neutral-300 hover:bg-white/5"
                    }`}
                  >
                    YTD
                  </button>
                </div>

                <Link
                  href="/"
                  className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-white/10"
                >
                  ← Back Home
                </Link>
                <Link
                  href="/pnl/upload"
                  className="inline-flex items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-400/15"
                >
                  Upload P&amp;L
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3 sm:p-8">
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-5 shadow-lg shadow-black/20">
              <div className="text-sm font-medium text-emerald-300/80">
                {metricLabel} Income
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {money(viewMode === "current" ? totals.currentIncome : totals.ytdIncome)}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-5 shadow-lg shadow-black/20">
              <div className="text-sm font-medium text-amber-300/80">
                {metricLabel} Expense
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {money(viewMode === "current" ? totals.currentExpense : totals.ytdExpense)}
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-5 shadow-lg shadow-black/20 sm:col-span-2 xl:col-span-1">
              <div className="text-sm font-medium text-cyan-300/80">
                {metricLabel} Net
              </div>
              <div
                className={`mt-3 text-3xl font-semibold tracking-tight ${netColor(
                  viewMode === "current" ? totals.currentNet : totals.ytdNet
                )}`}
              >
                {money(viewMode === "current" ? totals.currentNet : totals.ytdNet)}
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-neutral-900/70 p-6">
            Loading P&amp;L...
          </div>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/70 shadow-2xl backdrop-blur">
              <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Entity Summary
                  </h2>
                  <p className="text-sm text-neutral-400">
                    Showing {metricLabel.toLowerCase()} values for {prettyMonth(activeMonth)}. Click any entity to drill into the line items.
                  </p>
                </div>

                <button
                  onClick={exportEntitySummary}
                  className="inline-flex items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-400/15"
                >
                  Export Summary
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03] text-sm text-neutral-400">
                      <th className="px-6 py-4 text-left font-medium sm:px-8">
                        Entity
                      </th>
                      <th className="px-6 py-4 text-right font-medium sm:px-8">
                        Income
                      </th>
                      <th className="px-6 py-4 text-right font-medium sm:px-8">
                        Expense
                      </th>
                      <th className="px-6 py-4 text-right font-medium sm:px-8">
                        Net
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.map((row, index) => {
                      const income =
                        viewMode === "current"
                          ? asNumber(row.current_income)
                          : asNumber(row.ytd_income);
                      const expense =
                        viewMode === "current"
                          ? asNumber(row.current_expense)
                          : asNumber(row.ytd_expense);
                      const net =
                        viewMode === "current"
                          ? asNumber(row.current_net)
                          : asNumber(row.ytd_net);

                      const active = selectedEntity === row.entity;

                      return (
                        <tr
                          key={`${row.report_month}-${row.entity}`}
                          onClick={() => handleEntityClick(row.entity)}
                          className={`cursor-pointer border-b border-white/5 transition hover:bg-white/[0.06] ${
                            active
                              ? "bg-cyan-400/10"
                              : index % 2 === 0
                              ? "bg-transparent"
                              : "bg-white/[0.015]"
                          }`}
                        >
                          <td className="px-6 py-4 sm:px-8">
                            <div className="font-medium text-white">{row.entity}</div>
                          </td>
                          <td className="px-6 py-4 text-right text-neutral-200 sm:px-8">
                            {money(income)}
                          </td>
                          <td className="px-6 py-4 text-right text-neutral-200 sm:px-8">
                            {money(expense)}
                          </td>
                          <td
                            className={`px-6 py-4 text-right font-semibold sm:px-8 ${netColor(
                              net
                            )}`}
                          >
                            {money(net)}
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="bg-white/[0.04]">
                      <td className="px-6 py-5 font-semibold text-white sm:px-8">
                        Total
                      </td>
                      <td className="px-6 py-5 text-right font-semibold text-white sm:px-8">
                        {money(
                          viewMode === "current" ? totals.currentIncome : totals.ytdIncome
                        )}
                      </td>
                      <td className="px-6 py-5 text-right font-semibold text-white sm:px-8">
                        {money(
                          viewMode === "current" ? totals.currentExpense : totals.ytdExpense
                        )}
                      </td>
                      <td
                        className={`px-6 py-5 text-right font-semibold sm:px-8 ${netColor(
                          viewMode === "current" ? totals.currentNet : totals.ytdNet
                        )}`}
                      >
                        {money(
                          viewMode === "current" ? totals.currentNet : totals.ytdNet
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {selectedEntity ? (
              <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/70 shadow-2xl backdrop-blur">
                <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-col gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">
                      Detail Lines: {selectedEntity}
                    </h2>
                    <p className="text-sm text-neutral-400">
                      {prettyMonth(activeMonth)} · Current Income{" "}
                      {money(detailTotals.currentIncome)} · Current Expense{" "}
                      {money(detailTotals.currentExpense)} · YTD Income{" "}
                      {money(detailTotals.ytdIncome)} · YTD Expense{" "}
                      {money(detailTotals.ytdExpense)}
                    </p>
                  </div>

                  <button
                    onClick={exportDetailLines}
                    disabled={!detailRows.length}
                    className="inline-flex items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Export Detail
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px]">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.03] text-sm text-neutral-400">
                        <th className="px-6 py-4 text-left font-medium sm:px-8">
                          Section
                        </th>
                        <th className="px-6 py-4 text-left font-medium">
                          Account
                        </th>
                        <th className="px-6 py-4 text-left font-medium">
                          Description
                        </th>
                        <th className="px-6 py-4 text-right font-medium">
                          Current
                        </th>
                        <th className="px-6 py-4 text-right font-medium">
                          YTD
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailLoading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-6 py-6 text-sm text-neutral-400 sm:px-8"
                          >
                            Loading detail lines...
                          </td>
                        </tr>
                      ) : detailRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-6 py-6 text-sm text-neutral-400 sm:px-8"
                          >
                            No detail lines found.
                          </td>
                        </tr>
                      ) : (
                        detailRows.map((row, index) => (
                          <tr
                            key={`${row.entity}-${row.account_number}-${index}`}
                            className={`border-b border-white/5 ${
                              index % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"
                            }`}
                          >
                            <td className="px-6 py-4 text-neutral-200 sm:px-8">
                              {row.section}
                            </td>
                            <td className="px-6 py-4 text-neutral-200">
                              {row.account_number || "-"}
                            </td>
                            <td className="px-6 py-4 text-white">
                              {row.description || "-"}
                            </td>
                            <td className="px-6 py-4 text-right text-neutral-200">
                              {money(row.current_period)}
                            </td>
                            <td className="px-6 py-4 text-right text-neutral-200">
                              {money(row.year_to_date)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}