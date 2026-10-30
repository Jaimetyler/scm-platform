"use client";

import { useState } from "react";
import Link from "next/link";

export default function PnlUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [reportMonth, setReportMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!file) {
      setMessage("Please choose an Excel file.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("reportMonth", reportMonth);

      const res = await fetch("/api/pnl/upload", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();

      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(text || "Upload failed");
      }

      if (!res.ok) {
        throw new Error(json.error || "Upload failed");
      }

      setMessage("Upload processed successfully.");
      window.location.href = "/pnl";
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <Link
            href="/pnl"
            className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            ← Back to P&amp;L
          </Link>
        </div>

        <div className="rounded-3xl border border-white/10 bg-neutral-900/70 p-6 shadow-2xl">
          <h1 className="text-3xl font-semibold tracking-tight">Upload P&amp;L</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Upload the monthly Excel file and process it into the dashboard.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-200">
                Report Month
              </label>
              <input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none"
              />
              <p className="mt-2 text-xs text-neutral-500">
                Example: 2026-02
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-200">
                Excel File
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-cyan-500 px-5 py-3 font-medium text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Processing..." : "Upload and Process"}
            </button>

            {message ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200">
                {message}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </main>
  );
}