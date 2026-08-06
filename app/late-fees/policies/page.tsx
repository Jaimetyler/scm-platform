import Link from "next/link";

export default function LateFeePoliciesPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/late-fees"
          className="mb-6 inline-block text-sm text-slate-400 hover:text-white"
        >
          ← Back to Late Fees
        </Link>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
            Late Fees
          </p>

          <h1 className="mt-2 text-3xl font-bold">Policy Management</h1>

          <p className="mt-4 max-w-2xl text-slate-400">
            This page will be used to review and update customer late-fee
            policies, including grace periods, daily rates, bale rates, and
            tiered charges.
          </p>

          <div className="mt-8 rounded-xl border border-dashed border-white/15 p-6 text-slate-400">
            Policy editing is coming soon.
          </div>
        </div>
      </div>
    </main>
  );
}