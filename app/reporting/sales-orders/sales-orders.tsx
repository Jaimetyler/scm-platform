"use client";

import { useEffect, useState } from "react";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import styles from "./sales-orders.module.css";

type Summary = {salesperson: string; orders: number; revenue: number | null; recordedCarrierPay: number | null; comparableRevenue: number | null; margin: number | null; pending: number};
type Order = {orderId: string; customerCode: string; customerName: string; salesperson: string; billDate: string; status: string; revenue: number | null; carrierPay: number | null};
type Report = {people: {salesperson: string}[]; summaries: Summary[]; orders: Order[]; pageSize: number; pageOnly?: boolean; hasNext?: boolean; nextOffset?: number};
const firstDate = "2025-01-01";
const currency = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const money = (amount: number | null) => amount == null ? "—" : currency.format(amount);
const percent = (margin: number | null, revenue: number | null) => margin == null || !revenue ? "—" : `${(100 * margin / revenue).toFixed(1)}%`;
const sum = (rows: Summary[], key: "revenue" | "margin" | "comparableRevenue") =>
  rows.some(row => row[key] != null) ? rows.reduce((total, row) => total + (row[key] ?? 0), 0) : null;

export default function SalesOrders() {
  const [draft, setDraft] = useState(() => ({from: firstDate, through: new Date().toLocaleDateString("sv-SE", {timeZone: "America/New_York"}), salesperson: ""}));
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets[page - 1] ?? 0;
  const [report, setReport] = useState<Report | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({...filters, page: String(page), offset: String(offset)});
    fetch(`/api/reporting/sales-orders?${query}`, {signal: controller.signal})
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error ?? "Could not load sales orders.");
        setReport(result);
        setPeople(previous => [...new Set([...previous, ...result.people.map((person: {salesperson: string}) => person.salesperson)])].sort());
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, offset]);

  const summaries = report?.summaries ?? [];
  const count = summaries.reduce((total, row) => total + row.orders, 0);
  const pending = summaries.reduce((total, row) => total + row.pending, 0);
  const margin = sum(summaries, "margin");
  const pages = Math.max(1, Math.ceil(count / (report?.pageSize ?? 50)));

  return <main className={styles.page}>
    <PlatformPageHeader compact title="Sales Orders & Margin" subtitle="McLeod orders by bill date and current customer salesperson." />
    <form className={styles.filters} onSubmit={event => {event.preventDefault(); setPage(1); setOffsets([0]); setFilters({...draft});}}>
      <label>Bill date from<input type="date" required min={firstDate} max={draft.through} value={draft.from} onChange={event => setDraft({...draft, from: event.target.value})} /></label>
      <label>Through<input type="date" required min={draft.from} value={draft.through} onChange={event => setDraft({...draft, through: event.target.value})} /></label>
      <label>Salesperson<select value={draft.salesperson} onChange={event => setDraft({...draft, salesperson: event.target.value})}>
        <option value="">All salespeople</option>
        {people.map(person => <option key={person}>{person}</option>)}
      </select></label>
      <button type="submit" disabled={loading}>Apply filters</button>
    </form>
    {loading && <p role="status">Loading billed orders…</p>}
    {error && <p role="alert">{error}</p>}
    {report && !loading && !error && <>
      {report.pageOnly && <p>Live McLeod results. Totals and salesperson options reflect loaded pages. Use Next to review older orders.</p>}
      <dl className={styles.totals}>
        <div><dt>Billed orders</dt><dd>{count.toLocaleString()}</dd></div>
        <div><dt>Revenue</dt><dd>{money(sum(summaries, "revenue"))}</dd></div>
        <div><dt>Carrier margin</dt><dd>{money(margin)}</dd></div>
        <div><dt>Margin %</dt><dd>{percent(margin, sum(summaries, "comparableRevenue"))}</dd></div>
      </dl>
      <p>Carrier margin is billed revenue less current movement carrier pay. {pending.toLocaleString()} orders with incomplete amounts are excluded from margin. Customer payment data is pending.</p>
      <h2>Salesperson totals</h2>
      <div className={styles.scroll}><table>
        <thead><tr>{["Salesperson", "Orders", "Revenue", "Carrier pay", "Margin", "Margin %", "Incomplete"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{summaries.map(row => <tr key={row.salesperson}>
          <th scope="row">{row.salesperson}</th><td>{row.orders.toLocaleString()}</td>
          <td>{money(row.revenue)}</td><td>{money(row.recordedCarrierPay)}</td><td>{money(row.margin)}</td>
          <td>{percent(row.margin, row.comparableRevenue)}</td><td>{row.pending.toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>
      <h2>Billed orders</h2>
      {!count && <p>No matching billed orders in this batch.</p>}
      {count > 0 && <>
        <div className={styles.scroll}><table>
          <thead><tr>{["Order", "Customer", "Salesperson", "Bill date", "Status", "Revenue", "Carrier pay", "Margin", "Margin %"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{report.orders.map(order => {
            const orderMargin = order.revenue == null || order.carrierPay == null ? null : order.revenue - order.carrierPay;
            return <tr key={order.orderId}>
              <th scope="row">{order.orderId}</th><td>{order.customerName} <small>{order.customerCode}</small></td>
              <td>{order.salesperson}</td><td>{order.billDate}</td><td>{order.status}</td>
              <td>{money(order.revenue)}</td><td>{money(order.carrierPay)}</td>
              <td>{orderMargin == null ? "Pending" : money(orderMargin)}</td><td>{percent(orderMargin, order.revenue)}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </>}
      {(count > 0 || page > 1 || report.hasNext) && (
        <nav className={styles.filters} aria-label="Billed order pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page}{!report.pageOnly && ` of ${pages}`}</span>
          <button type="button" disabled={report.pageOnly ? !report.hasNext : page >= pages} onClick={() => { if (report.pageOnly) setOffsets(previous => [...previous.slice(0, page), report.nextOffset]); setPage(page + 1); }}>Next</button>
        </nav>
      )}
    </>}
  </main>;
}
