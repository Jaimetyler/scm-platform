export type ContainerInfoBooking = { booking_number: string; customer: string; customer_reference?: string | null };
type Line = { id: string; mark: string; line_status: string; load_source: string; source_row: number };
type Container = { booking_line_id: string | null; container_number: string | null; seal_number: string | null; split_transfer_id: string | null; sequence_no: number };
export function containerInfoRows(lines: Line[], containers: Container[]) {
  return lines.filter((line) => line.line_status === "active").sort((a, b) =>
    Number(a.load_source === "source_load") - Number(b.load_source === "source_load") || a.source_row - b.source_row).flatMap((line) => {
    const equipment = containers.filter((row) => row.booking_line_id === line.id && !row.split_transfer_id).sort((a, b) => a.sequence_no - b.sequence_no);
    return equipment.length ? equipment.map((row) => [line.mark, row.container_number || "", row.seal_number || ""]) : [[line.mark, "", ""]];
  });
}
const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ");
export function containerInfoText(booking: ContainerInfoBooking, rows: string[][]) {
  return [["Customer", booking.customer], ["Booking #", booking.booking_number], ["Customer ref", booking.customer_reference || ""],
    [], ["Mark", "Container", "Seal"], ...rows].map((row) => row.map(clean).join("\t")).join("\n");
}
export function containerInfoHtml(booking: ContainerInfoBooking, rows: string[][]) {
  const escape = (value: string) => clean(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  return `<p>Customer: ${escape(booking.customer)}<br>Booking #: ${escape(booking.booking_number)}<br>Customer ref: ${escape(booking.customer_reference || "")}</p><table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>Mark</th><th>Container</th><th>Seal</th></tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
