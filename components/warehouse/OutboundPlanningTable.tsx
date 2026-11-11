"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatBookingDate } from "@/lib/warehouse/outbound/details";
import { warehouseNow, type DashboardBooking } from "@/lib/warehouse/outbound/dashboard";
import type { PlanningInfo } from "@/lib/warehouse/outbound/planning-info";
import { bookingReturnLocationLabel } from "@/lib/warehouse/outbound/return-location";
import styles from "./OutboundPlanningTable.module.css";

type SortKey = "customer" | "booking_number" | "erd" | "cutoff" | "planned_containers" | "missing_marks";
const columns: { label: string; width: number; key?: SortKey }[] = [
  { label: "Location", width: 8 }, { label: "Customer", width: 9, key: "customer" }, { label: "Book ID", width: 7 },
  { label: "Containers", width: 7, key: "planned_containers" }, { label: "To load", width: 4 }, { label: "Loaded", width: 4 }, { label: "SSL", width: 3 },
  { label: "Booking #", width: 8, key: "booking_number" }, { label: "ERD", width: 7, key: "erd" },
  { label: "Cutoff", width: 8, key: "cutoff" }, { label: "Ramp / return", width: 7 },
  { label: "Uncovered", width: 7 }, { label: "Comments / alerts", width: 13 }, { label: "", width: 8 },
];

export default function OutboundPlanningTable({ bookings, activeBookings, returnTo, now }: {
  bookings: DashboardBooking[]; activeBookings: DashboardBooking[]; returnTo: string; now: Date;
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "cutoff", descending: false });
  const [info, setInfo] = useState<Record<string, PlanningInfo>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const dallasBookings = activeBookings.filter(item => item.terminal === "DAL");

  useEffect(() => () => { pending.current?.abort(); }, []);

  async function refresh(items: DashboardBooking[]) {
    if (pending.current || !items.length) return;
    const controller = new AbortController();
    pending.current = controller;
    setInfo(current => {
      const next = { ...current };
      for (const item of items) delete next[item.id];
      return next;
    });
    setErrors(current => {
      const next = { ...current };
      for (const item of items) delete next[item.id];
      return next;
    });
    try {
      for (const item of items) {
        if (controller.signal.aborted) break;
        setRefreshing(item.id);
        const timeout = AbortSignal.timeout(90_000);
        try {
          const response = await fetch(`/api/warehouse/outbound/bookings/${item.id}/planning-info`, {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, timeout]),
          });
          const result = await response.json();
          if (!response.ok || !result.ok) throw Error(result.error || "Could not refresh booking.");
          setInfo(current => ({ ...current, [item.id]: result.info }));
        } catch (error) {
          if (!controller.signal.aborted) {
            const message = timeout.aborted ? "Booking refresh timed out."
              : error instanceof Error ? error.message : "Booking refresh unavailable.";
            setErrors(current => ({ ...current, [item.id]: message }));
          }
        }
      }
    } finally {
      pending.current = null;
      setRefreshing(null);
    }
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
      <span>{rows.length} bookings · {rows.reduce((sum, row) => sum + row.requested_bales, 0).toLocaleString()} bales</span>
      {dallasBookings.length > 0 && <button className={styles.pull} type="button" disabled={!!refreshing}
        title="Refresh all active Dallas bookings in this location" onClick={() => void refresh(dallasBookings)}>Refresh bookings</button>}</div>
    <div className={styles.legend}><span>Dates:</span><span className={styles.scheduled}>Upcoming</span><span className={styles.today}>Today</span><span className={styles.overdue}>Past date</span><span>Uncovered counts matched SCM orders with no carrier. Loaded uses warehouse pickup departure.</span></div>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Booking planning table">
      <table className={styles.table} role="table">
        <caption className={styles.caption}>Active outbound bookings with warehouse inventory alerts. Sort using column headings.</caption>
        <colgroup>{columns.map(column => <col key={column.label} style={{ width: `${column.width}%` }} />)}</colgroup>
        <thead role="rowgroup"><tr role="row">{columns.map(column => <th role="columnheader" key={column.label} scope="col" aria-sort={column.key && sort.key === column.key ? sort.descending ? "descending" : "ascending" : undefined}>
          {column.key ? <button type="button" onClick={() => setSort(current => ({ key: column.key!, descending: current.key === column.key ? !current.descending : false }))}>{column.label}{sort.key === column.key ? sort.descending ? " ↓" : " ↑" : " ↕"}</button> : column.label}
        </th>)}</tr></thead>
        <tbody role="rowgroup">{rows.map(item => { const pulled = info[item.id]; return <tr role="row" key={item.id}>
          <td role="cell" data-label="Location">{item.site_name}</td><td role="cell" data-label="Customer" className={styles.customer}>{item.customer}</td><td role="cell" data-label="Book ID">{item.customer_reference || "—"}</td>
          <td role="cell" data-label="Containers" className={styles.count}>{item.planned_containers ?? "—"}</td>
          <td role="cell" data-label="To load" className={styles.number}>{pulled?.loaded != null && item.planned_containers != null ? Math.max(0, item.planned_containers - pulled.loaded) : "—"}</td>
          <td role="cell" data-label="Loaded" className={styles.number}>{pulled?.loaded ?? "—"}</td><td role="cell" data-label="SSL" title="Steamship line not recorded yet">—</td>
          <td role="cell" data-label="Booking #"><Link className={styles.booking} href={`/warehouse/outbound/${item.terminal.toLowerCase()}/${item.site_code}/${item.id}?returnTo=${returnTo}`}>{item.booking_number}</Link></td>
          <td role="cell" data-label="ERD" className={dateTone(item, item.erd)}>{formatBookingDate(item.erd)}</td>
          <td role="cell" data-label="Cutoff" className={dateTone(item, item.cutoff)}>{formatBookingDate(item.cutoff, item.cutoff_has_time)}</td>
          <td role="cell" data-label="Ramp / return">{bookingReturnLocationLabel(item.return_location, item.return_location_code)}</td>
          <td role="cell" data-label="Uncovered" className={!pulled?.complete ? styles.unknown : pulled.uncovered ? styles.shortage : styles.covered}>
            {item.terminal !== "DAL" ? "—" : pulled?.complete ? <details>
              <summary aria-label={`${pulled.uncovered} uncovered orders for booking ${item.booking_number}`}>{pulled.uncovered}</summary>
              {pulled.uncoveredOrderIds.length > 0 ? <ul aria-label="Uncovered SCM order numbers">
                {pulled.uncoveredOrderIds.map(id => <li key={id}>{id}</li>)}
              </ul> : <span>All matched orders have a carrier.</span>}
            </details> : "Unknown"}
          </td>
          <td role="cell" data-label="Comments / alerts" className={styles.alerts}>
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
          <td role="cell" data-label="">{item.terminal === "DAL" && <button className={styles.pull} type="button" disabled={!!refreshing}
            onClick={() => void refresh([item])} aria-label={`Refresh booking ${item.booking_number}`}>
            {refreshing === item.id ? "Refreshing…" : "Refresh this booking"}
          </button>}</td>
        </tr>; })}</tbody>
      </table>
    </div>
  </section>;
}
