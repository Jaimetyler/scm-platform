"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBookingDate } from "@/lib/warehouse/outbound/details";
import { warehouseNow, type DashboardBooking } from "@/lib/warehouse/outbound/dashboard";
import styles from "./OutboundPlanningTable.module.css";

type SortKey = "customer" | "booking_number" | "erd" | "cutoff" | "planned_containers" | "missing_marks";
const columns: { label: string; key?: SortKey }[] = [
  { label: "Location" }, { label: "Customer", key: "customer" }, { label: "Book ID" },
  { label: "Containers", key: "planned_containers" }, { label: "Bales" },
  { label: "Booking #", key: "booking_number" }, { label: "ERD", key: "erd" },
  { label: "Cutoff", key: "cutoff" }, { label: "Ramp / return" },
  { label: "Planning alerts" }, { label: "Missing marks", key: "missing_marks" },
];

export default function OutboundPlanningTable({ bookings, returnTo, now }: {
  bookings: DashboardBooking[]; returnTo: string; now: Date;
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "cutoff", descending: false });
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
    <div className={styles.legend}><span>Dates:</span><span className={styles.scheduled}>Upcoming</span><span className={styles.today}>Today</span><span className={styles.overdue}>Past date</span><span>Missing marks are inventory shortages, not uncovered trucks.</span></div>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Scrollable booking planning table">
      <table className={styles.table}>
        <caption className={styles.caption}>Active outbound bookings with warehouse inventory alerts. Sort using column headings.</caption>
        <thead><tr>{columns.map(column => <th key={column.label} scope="col" aria-sort={column.key && sort.key === column.key ? sort.descending ? "descending" : "ascending" : undefined}>
          {column.key ? <button type="button" onClick={() => setSort(current => ({ key: column.key!, descending: current.key === column.key ? !current.descending : false }))}>{column.label}{sort.key === column.key ? sort.descending ? " ↓" : " ↑" : " ↕"}</button> : column.label}
        </th>)}</tr></thead>
        <tbody>{rows.map(item => <tr key={item.id}>
          <td>{item.site_name}</td><td className={styles.customer}>{item.customer}</td><td>{item.customer_reference || "—"}</td>
          <td className={styles.count}>{item.planned_containers ?? "—"}</td><td className={styles.number}>{item.requested_bales.toLocaleString()}</td>
          <td><Link className={styles.booking} href={`/warehouse/outbound/${item.terminal.toLowerCase()}/${item.site_code}/${item.id}?returnTo=${returnTo}`}>{item.booking_number}</Link></td>
          <td className={dateTone(item, item.erd)}>{formatBookingDate(item.erd)}</td>
          <td className={dateTone(item, item.cutoff)}>{formatBookingDate(item.cutoff, item.cutoff_has_time)}</td>
          <td>{item.return_location || "—"}</td>
          <td className={styles.alerts}>
            {!!item.held_marks && <span className={styles.hold}>{item.held_marks} marks on hold</span>}
            {!!item.source_arrivals && <span className={styles.arrival}>{item.source_arrivals} source arrivals — review</span>}
            {!!item.source_loads && <span>{item.source_loads} source loads</span>}
            {item.doc_cutoff && <span>Doc cutoff: {formatBookingDate(item.doc_cutoff, item.doc_cutoff_has_time)}</span>}
            {!item.held_marks && !item.source_arrivals && !item.source_loads && !item.doc_cutoff && <span>—</span>}
          </td>
          <td className={item.missing_marks == null ? styles.unknown : item.missing_marks > 0 ? styles.shortage : styles.covered}>{item.missing_marks ?? "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
