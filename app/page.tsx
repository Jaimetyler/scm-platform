import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold mb-4">SCM Platform</h1>
        <Link
          href="/pnl"
          className="inline-block rounded-xl border border-neutral-700 px-4 py-2 hover:border-neutral-500"
        >
          Open P&amp;L Dashboard
        </Link>
      </div>
    </main>
  );
}