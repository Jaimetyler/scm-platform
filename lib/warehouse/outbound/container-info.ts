import * as XlsxModule from "xlsx/xlsx.mjs";
import type * as XlsxTypes from "xlsx";
const XLSX = XlsxModule as typeof XlsxTypes;
import { containerInfoRows, type ContainerInfoBooking } from "./container-info-rows.ts";
export function containerInfoWorkbook(booking: ContainerInfoBooking, lines: Parameters<typeof containerInfoRows>[0], containers: Parameters<typeof containerInfoRows>[1]) {
  const rows = [["SCM · Container information"], ["Customer", booking.customer], ["Booking #", booking.booking_number],
    ["Customer ref", booking.customer_reference || ""], [], ["Mark", "Container", "Seal"], ...containerInfoRows(lines, containers)];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 30 }, { wch: 38 }, { wch: 28 }];
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, ...Array.from({ length: 3 }, (_, i) => ({ s: { r: i + 1, c: 1 }, e: { r: i + 1, c: 2 } }))];
  sheet["!autofilter"] = { ref: `A6:C${Math.max(6, rows.length)}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Container Info");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
