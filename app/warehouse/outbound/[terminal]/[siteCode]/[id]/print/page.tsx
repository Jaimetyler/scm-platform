"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BookingPrintSheet, { type PrintBooking, type PrintLine, type PrintContainer } from "@/components/warehouse/BookingPrintSheet";
import "./print.css";

export default function WarehouseBookingPrintPage() {
  const params = useParams<{ terminal: string; siteCode: string; id: string }>();
  const [data, setData] = useState<{ booking: PrintBooking; lines: PrintLine[]; containers: PrintContainer[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const query = new URLSearchParams({ terminal: params.terminal.toUpperCase(), siteCode: params.siteCode });
        const response = await fetch(`/api/warehouse/outbound/bookings/${params.id}?${query}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not load booking sheet");
        if (!cancelled) setData(result);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load booking sheet"); }
    }
    void load();
    return () => { cancelled = true; };
  }, [params.terminal, params.siteCode, params.id]);
  return <main>
    <div className="booking-print-toolbar">
      <Link href={`/warehouse/outbound/${params.terminal}/${params.siteCode}/${params.id}`}>← Booking</Link>
      <button disabled={!data || Boolean(error)} onClick={() => window.print()}>Print / Save PDF</button>
      <span>Saved booking details · Letter landscape · Blank cells for warehouse handwriting</span>
    </div>
    {error ? <p role="alert" style={{ color: "#fca5a5" }}>{error}</p> : data ? <BookingPrintSheet {...data} /> : <p style={{ color: "white" }}>Loading warehouse sheet…</p>}
  </main>;
}
