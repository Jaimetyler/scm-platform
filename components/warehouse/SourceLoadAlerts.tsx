"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Alert = { id: string; mark: string; arrival_site_name: string;
  line: { booking: { id: string; booking_number: string; terminal: string; site_code: string } } };
export default function SourceLoadAlerts({ terminal, siteCode }: { terminal?: string; siteCode?: string }) {
  const [arrivals, setArrivals] = useState<Alert[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const query = terminal && siteCode ? `?${new URLSearchParams({ terminal, siteCode })}` : "";
        const response = await fetch(`/api/warehouse/outbound/source-arrivals${query}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!disposed) { setArrivals(result.arrivals); setError(""); }
      } catch { if (!disposed) setError("Source-load arrival alerts could not be refreshed."); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [terminal, siteCode]);
  if (!arrivals.length && !error) return null;
  return <div role="alert" style={{ border: "1px solid #d97706", background: "rgba(180,83,9,.12)", padding: 16, borderRadius: 10, color: "#fde68a", margin: "12px 0" }}>
    {error && <p>{error}</p>}
    {arrivals.length > 0 && <><strong>Source loads arrived at the warehouse — review the booking plan</strong>
      <p style={{ fontSize: 13 }}>These marks were planned for direct pickup in a container. Receiving can continue; review each booking and convert the load if its plan has changed.</p>
      {arrivals.map((arrival) => <div key={arrival.id} style={{ marginTop: 6 }}>{arrival.mark} · {arrival.arrival_site_name} · <Link style={{ color: "#7dd3fc" }}
        href={`/warehouse/outbound/${arrival.line.booking.terminal.toLowerCase()}/${arrival.line.booking.site_code}/${arrival.line.booking.id}`}>
        Review booking {arrival.line.booking.booking_number}</Link></div>)}</>}
  </div>;
}
