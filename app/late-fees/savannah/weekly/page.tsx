"use client";

import { useState } from "react";

export default function SavannahWeeklyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function handleUpload() {
    if (!file) return;

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/late-fees/savannah/weekly-preview", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, color: "#fff" }}>
      <h1>Savannah Weekly Reconciliation</h1>

      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button onClick={handleUpload} disabled={!file || loading}>
          {loading ? "Processing..." : "Preview"}
        </button>
      </div>

      {result && (
        <pre style={{ marginTop: 24, padding: 16, background: "#111", overflow: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}