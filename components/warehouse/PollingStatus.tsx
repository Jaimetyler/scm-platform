"use client";
export default function PollingStatus({ lastSuccessAt, refreshing, error }: { lastSuccessAt: number | null; refreshing?: boolean; error?: string }) {
  return <small role="status" style={{ color: "#94a3b8", margin: "0 10px" }}>
    {error && `${error} `}{refreshing ? "Refreshing…" : lastSuccessAt ? `Updated ${new Date(lastSuccessAt).toLocaleTimeString()}` : "Not refreshed yet"}
  </small>;
}
