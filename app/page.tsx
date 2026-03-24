import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-8">
      <div className="text-center max-w-xl w-full">
        <h1 className="text-3xl font-semibold mb-6">SCM Platform</h1>

        <div className="flex flex-col gap-3">
          {/* P&L */}
          <Link
            href="/pnl"
            className="inline-block rounded-xl border border-neutral-700 px-4 py-3 hover:border-neutral-500"
          >
            Open P&amp;L Dashboard
          </Link>

          {/* Inbound Processor */}
          <Link
            href="/inbound"
            className="inline-block rounded-xl border border-blue-700 px-4 py-3 hover:border-blue-500"
          >
            Process Check-In Sheet
          </Link>

          {/* Inbound History */}
          <Link
            href="/inbound/history"
            className="inline-block rounded-xl border border-neutral-700 px-4 py-3 hover:border-neutral-500"
          >
            View Inbound History
          </Link>
        </div>
      </div>
    </main>
  );
}