"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatBookingDate } from "@/lib/warehouse/outbound/details";
import { warehouseNow, type DashboardBooking } from "@/lib/warehouse/outbound/dashboard";
import type { PlanningInfo } from "@/lib/warehouse/outbound/planning-info";
import styles from "./OutboundPlanningTable.module.css";

type SortKey = "customer" | "booking_number" | "erd" | "cutoff" | "planned_containers" | "missing_marks";
const columns: { label: string; key?: SortKey }[] = [
  { label: "Location" }, { label: "Customer", key: "customer" }, { label: "Book ID" },
  { label: "Containers", key: "planned_containers" }, { label: "To load" }, { label: "Loaded" }, { label: "SSL" },
  { label: "Booking #", key: "booking_number" }, { label: "ERD", key: "erd" },
  { label: "Cutoff", key: "cutoff" }, { label: "Ramp / return" },
  { label: "Carrier" }, { label: "Comments / alerts" }, { label: "Uncovered" }, { label: "" },
];

export default function OutboundPlanningTable({ bookings, returnTo, now }: {
  bookings: DashboardBooking[]; returnTo: string; now: Date;
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "cutoff", descending: false });
  const [info, setInfo] = useState<Record<string, PlanningInfo>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pulling, setPulling] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  async function pull(item: DashboardBooking) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 90_000);
    setPulling(item.id);
    setInfo(current => { const next = { ...current }; delete next[item.id]; return next; });
    setErrors(current => ({ ...current, [item.id]: "" }));
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${item.id}/planning-info`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || "Could not pull booking info.");
      setInfo(current => ({ ...current, [item.id]: result.info }));
    } catch (error) {
      if (!controller.signal.aborted) setErrors(current => ({ ...current, [item.id]: error instanceof Error ? error.message : "Lookup unavailable." }));
      else setErrors(current => ({ ...current, [item.id]: "Lookup interrupted. Retry Pull info." }));
    } finally { window.clearTimeout(timeout); pending.current = null; setPulling(null); }
  }
  const rows = [...bookings].sort((a, b) => {
    const left = a[sort.key], right = b[sort.key];
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    const result = typeof left === "number" && typeof right === "number" ? left - right
      : String(left).localeCompare(String(right), undefined, { numeric: true });
    return (sort.descending ? -result : result) || a.booking_number.localeCompare(b.booking_number);
  });
  function dateTone(item: DashboardBooking, value: string | null) {
    if (!value) return styles.unknown;
    const day = value.slice(0, 10), today = warehouseNow(item.terminal, now).slice(0, 10);
    return day < today ? styles.overdue : day === today ? styles.today : styles.scheduled;
  }
  return <section className={styles.panel} aria-label="Outbound planning sheet">
    <div className={styles.heading}><div><strong>Outbound planning sheet</strong><p>One booking per row · click a booking to open its load plan</p></div>
      <span>{rows.length} bookings · {rows.reduce((sum, row) => sum + row.requested_bales, 0).toLocaleString()} bales</span></div>
    <div className={styles.legend}><span>Dates:</span><span className={styles.scheduled}>Upcoming</span><span className={styles.today}>Today</span><span className={styles.overdue}>Past date</span><span>Uncovered = matched SCM orders with no carrier. ? = lookup or order match still needed. Loaded uses warehouse pickup departure.</span></div>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Scrollable booking planning table">
      <table className={styles.table}>
        <caption className={styles.caption}>Active outbound bookings with warehouse inventory alerts. Sort using column headings.</caption>
        <thead><tr>{columns.map(column => <th key={column.label} scope="col" aria-sort={column.key && sort.key === column.key ? sort.descending ? "descending" : "ascending" : undefined}>
          {column.key ? <button type="button" onClick={() => setSort(current => ({ key: column.key!, descending: current.key === column.key ? !current.descending : false }))}>{column.label}{sort.key === column.key ? sort.descending ? " ↓" : " ↑" : " ↕"}</button> : column.label}
        </th>)}</tr></thead>
        <tbody>{rows.map(item => { const pulled = info[item.id]; return <tr key={item.id}>
          <td>{item.site_name}</td><td className={styles.customer}>{item.customer}</td><td>{item.customer_reference || "—"}</td>
          <td className={styles.count}>{item.planned_containers ?? "—"}</td>
          <td className={styles.number}>{pulled?.loaded != null && item.planned_containers != null ? Math.max(0, item.planned_containers - pulled.loaded) : "—"}</td>
          <td className={styles.number}>{pulled?.loaded ?? "—"}</td><td title="Steamship line not recorded yet">—</td>
          <td><Link className={styles.booking} href={`/warehouse/outbound/${item.terminal.toLowerCase()}/${item.site_code}/${item.id}?returnTo=${returnTo}`}>{item.booking_number}</Link></td>
          <td className={dateTone(item, item.erd)}>{formatBookingDate(item.erd)}</td>
          <td className={dateTone(item, item.cutoff)}>{formatBookingDate(item.cutoff, item.cutoff_has_time)}</td>
          <td>{item.return_location || "—"}</td>
          <td className={styles.alerts}>{pulled ? pulled.carriers.join(", ") || (pulled.matchedOrders && !pulled.unknownCarriers ? "No carrier assigned" : "Not verified") : "—"}</td>
          <td className={styles.alerts}>
            {!!item.missing_marks && <span className={styles.hold}>{item.missing_marks} inventory marks missing</span>}
            {pulled && <span>Matched {pulled.matchedOrders} SCM orders · checked {new Date(pulled.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
            {pulled && !pulled.complete && <span className={styles.arrival}>Coverage incomplete — {pulled.unknownCarriers ? `${pulled.unknownCarriers} carrier assignments unknown` : "review matched order count"}</span>}
            {errors[item.id] && <span role="alert" className={styles.hold}>{errors[item.id]}</span>}
            {!!item.held_marks && <span className={styles.hold}>{item.held_marks} marks on hold</span>}
            {!!item.source_arrivals && <span className={styles.arrival}>{item.source_arrivals} source arrivals — review</span>}
            {!!item.source_loads && <span>{item.source_loads} source loads</span>}
            {item.doc_cutoff && <span>Doc cutoff: {formatBookingDate(item.doc_cutoff, item.doc_cutoff_has_time)}</span>}
            {!item.held_marks && !item.source_arrivals && !item.source_loads && !item.doc_cutoff && <span>—</span>}
          </td>
          <td className={!pulled ? styles.unknown : pulled.uncovered > 0 ? styles.shortage : pulled.complete ? styles.covered : styles.unknown}
            title={pulled?.complete ? "Confirmed matched orders without a carrier" : "Coverage is not fully verified"}>{pulled ? `${pulled.uncovered}${pulled.complete ? "" : " + ?"}` : "—"}</td>
          <td><button className={styles.pull} type="button" disabled={!!pulling || item.terminal !== "DAL"} onClick={() => void pull(item)} aria-label={`Pull info for booking ${item.booking_number}`}>{pulling === item.id ? "Pulling…" : "Pull info"}</button></td>
        </tr>; })}</tbody>
      </table>
    </div>
  </section>;
}
