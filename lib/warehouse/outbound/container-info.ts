import * as XlsxModule from "xlsx/xlsx.mjs";
import type * as XlsxTypes from "xlsx";
const XLSX = XlsxModule as typeof XlsxTypes;
type Booking = { booking_number: string; customer: string; customer_reference?: string | null; site_name: string;
  vessel?: string | null; erd?: string | null; doc_cutoff?: string | null; cutoff?: string | null;
  doc_cutoff_has_time?: boolean; cutoff_has_time?: boolean };
type Line = { id: string; mark: string; line_status: string; load_source: string; source_row: number };
type Container = { booking_line_id: string | null; container_number: string | null; seal_number: string | null; split_transfer_id: string | null; sequence_no: number };
function sailingDate(value: string | null | undefined, hasTime = false) {
  return value ? value.replace("T", " ").slice(0, hasTime ? 16 : 10) : "";
}
export function containerInfoWorkbook(booking: Booking, lines: Line[], containers: Container[]) {
  const rows: unknown[][] = [
    ["SCM · Container information"], ["Customer", booking.customer], ["Booking", booking.booking_number],
    ["Customer reference", booking.customer_reference || ""], ["Warehouse", booking.site_name], ["Vessel", booking.vessel || ""],
    ["ERD", sailingDate(booking.erd)], ["Doc cutoff", sailingDate(booking.doc_cutoff, booking.doc_cutoff_has_time !== false)],
    ["Cutoff", sailingDate(booking.cutoff, booking.cutoff_has_time !== false)], [], ["Mark", "Container number", "Seal number"],
  ];
  for (const line of lines.filter((line) => line.line_status === "active").sort((a, b) =>
    Number(a.load_source === "source_load") - Number(b.load_source === "source_load") || a.source_row - b.source_row)) {
    const equipment = containers.filter((row) => row.booking_line_id === line.id && !row.split_transfer_id).sort((a, b) => a.sequence_no - b.sequence_no);
    if (!equipment.length) rows.push([line.mark, "", ""]);
    else equipment.forEach((row) => rows.push([line.mark, row.container_number || "", row.seal_number || ""]));
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 30 }, { wch: 38 }, { wch: 28 }];
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, ...Array.from({ length: 8 }, (_, i) => ({ s: { r: i + 1, c: 1 }, e: { r: i + 1, c: 2 } }))];
  sheet["!autofilter"] = { ref: `A11:C${Math.max(11, rows.length)}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Container Info");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
