"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import HoustonBookingForms, { type HoustonFormData } from "@/components/warehouse/HoustonBookingForms";
import "./forms.css";

export default function HoustonBookingFormPage() {
  const { terminal, siteCode, id, form } = useParams<{ terminal: string; siteCode: string; id: string; form: string }>();
  const [data, setData] = useState<HoustonFormData | null>(null);
  const [error, setError] = useState("");
  const preview = useRef<HTMLDivElement>(null);
  const printed = useRef(false);
  const manifest = form === "manifest";
  const valid = terminal.toUpperCase() === "HOU" && (manifest || form === "empty-request");
  const printable = Boolean(data && (!manifest || data.lines.some(line => line.line_status === "active")));

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ terminal: "HOU", siteCode, view: "houston-form" });
        const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not load booking.");
        setData(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load booking.");
      }
    }
    void load();
    return () => controller.abort();
  }, [valid, siteCode, id]);

  useEffect(() => {
    if (!printable || printed.current) return;
    let cancelled = false;
    async function openPrintDialog() {
      const logo = preview.current?.querySelector("img");
      if (logo) await logo.decode().catch(() => {});
      await document.fonts.ready;
      if (cancelled) return;
      printed.current = true;
      window.print();
    }
    void openPrintDialog();
    return () => { cancelled = true; };
  }, [printable]);

  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium" }).format(new Date());
  return <main className="hou-form">
    <div className="hou-form-toolbar">
      <Link href={`/warehouse/outbound/${terminal}/${siteCode}/${id}`}>← Booking</Link>
      <button type="button" disabled={!printable} onClick={() => window.print()}>Print / Save PDF</button>
    </div>
    <div ref={preview}>
      {!valid ? <p role="alert">Unknown Houston booking form.</p> :
        error ? <p role="alert">{error}</p> :
        data ? <HoustonBookingForms {...data} manifest={manifest} date={date} /> : <p>Loading booking…</p>}
    </div>
  </main>;
}
