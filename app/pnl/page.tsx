export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

type PnlRow = {
  report_month: string;
  entity: string;
  current_income: string | number | null;
  current_expense: string | number | null;
  current_net: string | number | null;
};

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

async function getRows(): Promise<PnlRow[]> {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      `Missing env vars. URL loaded: ${url ? "yes" : "no"}, KEY loaded: ${key ? "yes" : "no"}`
    );
  }

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("v_pnl_monthly_summary")
    .select(
      "report_month, entity, current_income, current_expense, current_net"
    )
    .order("report_month", { ascending: false })
    .order("entity", { ascending: true });

  if (error) {
    throw new Error(`Supabase error loading P&L monthly summary: ${error.message}`);
  }

  return data ?? [];
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

export default async function PnlPage() {
  const rows = await getRows();

  const latestMonth = rows[0]?.report_month ?? null;

  const latestRows = rows
    .filter((r) => r.report_month === latestMonth)
    .sort((a, b) => {
      const aIndex = entityOrder.indexOf(a.entity);
      const bIndex = entityOrder.indexOf(b.entity);
      const aRank = aIndex === -1 ? 999 : aIndex;
      const bRank = bIndex === -1 ? 999 : bIndex;
      return aRank - bRank;
    });

  const totals = latestRows.reduce(
    (acc, row) => {
      acc.income += asNumber(row.current_income);
      acc.expense += asNumber(row.current_expense);
      acc.net += asNumber(row.current_net);
      return acc;
    },
    { income: 0, expense: 0, net: 0 }
  );

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
                    {prettyMonth(latestMonth)}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-white/10"
                >
                  ← Back Home
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3 sm:p-8">
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-5 shadow-lg shadow-black/20">
              <div className="text-sm font-medium text-emerald-300/80">
                Current Income
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {money(totals.income)}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-5 shadow-lg shadow-black/20">
              <div className="text-sm font-medium text-amber-300/80">
                Current Expense
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {money(totals.expense)}
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-5 shadow-lg shadow-black/20 sm:col-span-2 xl:col-span-1">
              <div className="text-sm font-medium text-cyan-300/80">
                Current Net
              </div>
              <div
                className={`mt-3 text-3xl font-semibold tracking-tight ${netColor(
                  totals.net
                )}`}
              >
                {money(totals.net)}
              </div>
            </div>
          </div>
        </div>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/70 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-2 border-b border-white/10 px-6 py-5 sm:px-8">
            <h2 className="text-xl font-semibold tracking-tight">
              Entity Summary
            </h2>
            <p className="text-sm text-neutral-400">
              Income, expense, and net by operating group for the latest reporting month.
            </p>
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
                {latestRows.map((row, index) => {
                  const net = asNumber(row.current_net);

                  return (
                    <tr
                      key={`${row.report_month}-${row.entity}`}
                      className={`border-b border-white/5 transition hover:bg-white/[0.03] ${
                        index % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"
                      }`}
                    >
                      <td className="px-6 py-4 sm:px-8">
                        <div className="font-medium text-white">{row.entity}</div>
                      </td>
                      <td className="px-6 py-4 text-right text-neutral-200 sm:px-8">
                        {money(row.current_income)}
                      </td>
                      <td className="px-6 py-4 text-right text-neutral-200 sm:px-8">
                        {money(row.current_expense)}
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
                    {money(totals.income)}
                  </td>
                  <td className="px-6 py-5 text-right font-semibold text-white sm:px-8">
                    {money(totals.expense)}
                  </td>
                  <td
                    className={`px-6 py-5 text-right font-semibold sm:px-8 ${netColor(
                      totals.net
                    )}`}
                  >
                    {money(totals.net)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}