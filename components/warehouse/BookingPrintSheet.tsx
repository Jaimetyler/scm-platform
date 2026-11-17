import { formatBookingDate } from "@/lib/warehouse/outbound/details";

export type PrintBooking = { terminal?: string | null; scm_file_number?: string | null; book_id?: string | null; booking_number: string; customer: string; customer_reference?: string | null; site_name: string;
  requested_bales: number; planned_containers?: number | null; erd?: string | null; doc_cutoff?: string | null;
  cutoff?: string | null; doc_cutoff_has_time?: boolean; cutoff_has_time?: boolean; vessel?: string | null };
export type PrintLine = { id: string; mark: string; requested_bales: number; inventory_locations: string[]; shipping_order?: string | null; line_status?: string; load_source?: string; source_warehouse?: string };
export type PrintContainer = { id: string; sequence_no: number; booking_line_id: string | null; split_transfer_id?: string | null;
  scm_order_number?: string | null; container_number?: string | null; seal_number?: string | null; chassis_number?: string | null; notes?: string | null;
  split?: { mark: string; bales: number; target_booking_number: string } | null };

export type PrintHistory = { id: string; mark: string; action: string; date: string; booking?: string | null; bales?: number; note?: string | null };

export default function BookingPrintSheet({ booking, lines, containers, history = [] }: {
  booking: PrintBooking; lines: PrintLine[]; containers: PrintContainer[]; history?: PrintHistory[];
}) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const activeLines = lines.filter((line) => !line.line_status || line.line_status === "active");
  const active = containers.filter((row) => !row.split_transfer_id && (!row.booking_line_id || activeLines.some((line) => line.id === row.booking_line_id)));
  const assigned = new Set(active.map((row) => row.booking_line_id));
  const unassigned = activeLines.filter((line) => !assigned.has(line.id));
  const isDallas = booking.terminal === "DAL";
  const legacyDallasBookId = isDallas && !booking.book_id && containers.some(row => row.scm_order_number)
    ? booking.scm_file_number : null;
  const bookId = booking.book_id || legacyDallasBookId;
  const scmFileNumber = legacyDallasBookId ? null : booking.scm_file_number;
  const remainingMarks = [...unassigned];
  const printOnlyMarks = new Set<string>();
  const loadRows = isDallas ? [...active].sort((a,b) => a.sequence_no-b.sequence_no).map(row => {
    if (row.booking_line_id || row.container_number || row.seal_number || row.chassis_number || row.notes) return row;
    const line = remainingMarks.shift();
    if (!line) return row;
    printOnlyMarks.add(row.id);
    return {...row, booking_line_id:line.id};
  }) : active;
  // When load slots exist in Dallas, list excess marks separately from the numbered loads.
  const extraMarks = isDallas && active.length ? remainingMarks : unassigned;
  const rows = isDallas && active.length ? loadRows : [...loadRows, ...extraMarks.map((line, index) => ({
    id: line.id, sequence_no: active.length + index + 1, booking_line_id: line.id,
  }))].sort((a, b) => Number(lineById.get(a.booking_line_id ?? "")?.load_source === "source_load") - Number(lineById.get(b.booking_line_id ?? "")?.load_source === "source_load") || a.sequence_no - b.sequence_no);
  const moved = containers.filter((row) => row.split_transfer_id);
  return <article className="booking-print-sheet">
    <table className="booking-print-table">
      <colgroup>{[3,11,6,11,10,17,10,14,18].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
      <thead>
        <tr><th colSpan={9} className="booking-print-heading">
          <img src="/scm-logo.png" alt="SCM" style={{ width: 130, height: "auto", float: "right" }} />
          <div className="booking-print-title">SCM · Warehouse file</div>
          <div><b>SCM File #</b> {scmFileNumber || "—"}</div>
          <div><b>Book ID</b> {bookId || "—"}</div>
          <h1>Booking {booking.booking_number}</h1>
          <div className="booking-print-details">
            <div><b>Customer</b> {booking.customer}</div><div><b>Warehouse</b> {booking.site_name}</div><div><b>Customer ref</b> {booking.customer_reference || "—"}</div>
            <div><b>Vessel</b> {booking.vessel || "—"}</div><div><b>ERD</b> {formatBookingDate(booking.erd)}</div>
            <div><b>Doc cutoff</b> {formatBookingDate(booking.doc_cutoff, booking.doc_cutoff_has_time !== false)}</div>
            <div><b>Cutoff</b> {formatBookingDate(booking.cutoff, booking.cutoff_has_time !== false)}</div>
            <div><b>Requested bales</b> {booking.requested_bales}</div><div><b>Planned containers</b> {booking.planned_containers ?? "—"}</div>
          </div>
        </th></tr>
        <tr>{["#", "Mark", "Bales", "Location", "S.O.", "Container number", "Seal", "Chassis", "Notes"].map((label) => <th key={label}>{label}</th>)}</tr>
      </thead>
      <tbody>{rows.map((row: PrintContainer) => {
        const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
        return <tr key={row.id}><td>{row.sequence_no}</td><td>{line?.mark || ""}{printOnlyMarks.has(row.id) && <small style={{ display: "block" }}>Unassigned</small>}{line?.load_source === "source_load" && <small style={{ display: "block" }}>Source load</small>}</td><td>{line?.requested_bales ?? ""}</td>
          <td>{(line?.load_source === "source_load" ? line.source_warehouse : line?.inventory_locations.join(", ")) || ""}</td><td>{line?.shipping_order || ""}</td>
          <td>{row.container_number || ""}</td><td>{row.seal_number || ""}</td><td>{row.chassis_number || ""}</td><td>{row.notes || ""}</td></tr>;
      })}</tbody>
    </table>
    {isDallas && active.length > 0 && remainingMarks.length > 0 && <p className="booking-print-transfers">
      <b>Additional unassigned marks:</b> {remainingMarks.map(line => `${line.mark} (${line.requested_bales} bales)`).join(", ")}
    </p>}
    {lines.some((line) => line.line_status === "on_hold" || line.line_status === "cancelled") && <p className="booking-print-transfers"><b>Excluded from loading:</b> {lines.filter((line) => line.line_status === "on_hold" || line.line_status === "cancelled").map((line) => `${line.mark} (${line.line_status === "on_hold" ? "On hold" : "Cancelled"})`).join("; ")}</p>}
    {history.length > 0 && <section className="booking-print-transfers" aria-label="Booking history">
      <b>Booking history</b>
      <ul>{history.map(event => <li key={event.id}>
        {new Intl.DateTimeFormat("en-US", { dateStyle:"medium", timeZone:booking.terminal === "DAL" || booking.terminal === "HOU" ? "America/Chicago" : "America/New_York" }).format(new Date(event.date))}
        {" · "}{event.mark} · {event.action}{event.bales !== undefined ? ` ${event.bales} bales` : ""}
        {event.booking ? ` ${event.action === "Moved in" ? "from" : "to"} booking ${event.booking}` : ""}
        {event.note ? ` · ${event.note}` : ""}
      </li>)}</ul>
    </section>}
    {history.length === 0 && moved.length > 0 && <p className="booking-print-transfers"><b>Split history:</b> {moved.map((row) => `${row.split?.mark || "Moved mark"} (${row.split?.bales ?? "—"} bales) → booking ${row.split?.target_booking_number || "—"}`).join("; ")}</p>}
    <div className="booking-print-signoff">Loaded by: ____________________ &nbsp; Date: ______________ &nbsp; Checked by: ____________________</div>
    <p className="booking-print-footer">Record final container, seal, and chassis information in SCM. Blank cells are provided for warehouse notes.</p>
  </article>;
}
