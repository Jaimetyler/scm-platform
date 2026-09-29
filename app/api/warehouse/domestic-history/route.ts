import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";

const FIELDS = "id,terminal,site_code,site_name,sub_location,checkin_source,received_date,checked_in_at,verified_at,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at,yard_status,yard_updated_by,driver_name,driver_phone,trucking_company,movement_direction,material_type,reference_number,mark,bol_bc,bale_count,shipper,destination,matched_order_id,draft_status,processing_error,processed_at,warehouse_location,equipment_type,verified,comment_1,comment_2,bol_photo_original_name,bol_photo_uploaded_at,created_at,updated_at";
const HEADERS: [string, string][] = [
  ["terminal", "Terminal"], ["site_code", "Site code"], ["site_name", "Site"], ["sub_location", "Sub-location"],
  ["received_date", "Received date"], ["checked_in_at", "Arrived (UTC)"], ["verified_at", "Verified (UTC)"],
  ["yard_called_at", "Called (UTC)"], ["yard_in_door_at", "In door (UTC)"], ["yard_work_started_at", "Work started (UTC)"],
  ["yard_completed_at", "Checked out (UTC)"],
  ["yard_status", "Yard status"], ["yard_updated_by", "Checked out / updated by"],
  ["driver_name", "Driver"], ["driver_phone", "Driver phone"], ["trucking_company", "Trucking company"],
  ["movement_direction", "Pickup / delivery"],
  ["material_type", "Material"], ["reference_number", "Reference"], ["mark", "Mark"],
  ["bol_bc", "BOL bale count"], ["bale_count", "Bales unloaded"], ["shipper", "Customer"],
  ["destination", "Destination"], ["matched_order_id", "McLeod order ID"],
  ["draft_status", "McLeod processing status"], ["processing_error", "Processing error"],
  ["processed_at", "McLeod processed (UTC)"], ["checkin_source", "Check-in source"],
  ["warehouse_location", "Warehouse location"], ["equipment_type", "Equipment type"], ["verified", "Verified"],
  ["comment_1", "Notes"], ["comment_2", "Additional notes"], ["bol_photo_original_name", "Paperwork file"],
  ["bol_photo_uploaded_at", "Paperwork uploaded (UTC)"],
  ["id", "Check-in ID"], ["created_at", "Created (UTC)"], ["updated_at", "Updated (UTC)"],
];

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

function warehouseMidnight(date: string, terminal: string) {
  const zone = terminal === "HOU" ? "America/Chicago" : "America/New_York";
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    instant += target - local;
  }
  return new Date(instant).toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const terminal = (params.get("terminal") ?? "").toUpperCase();
    const siteCode = params.get("siteCode") ?? "";
    if (!CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode)) {
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    }
    const search = (params.get("search") ?? "").trim().replace(/[,%().*]/g, "").slice(0, 100);
    const status = params.get("status") ?? "all";
    if (!["all", "completed", "cancelled"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }
    const from = params.get("from") ?? "";
    const through = params.get("through") ?? "";
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if ((from && !validDate(from)) || (through && !validDate(through))) {
      return NextResponse.json({ ok: false, error: "Use valid dates" }, { status: 400 });
    }
    const exportFile = params.get("export") === "xlsx";
    const page = Math.max(0, Math.min(100000, Number.parseInt(params.get("page") ?? "0", 10) || 0));
    const pageSize = 100;
    const makeQuery = () => {
      let query = database().from("inbound_checkin_rows").select(FIELDS)
        .eq("terminal", terminal).eq("site_code", siteCode)
        .in("material_type", ["cotton", "lumber", "other"])
        .in("yard_status", status === "all" ? ["completed", "cancelled"] : [status]);
      if (from) query = query.gte("checked_in_at", warehouseMidnight(from, terminal));
      if (through) {
        const end = new Date(`${through}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        query = query.lt("checked_in_at", warehouseMidnight(end.toISOString().slice(0, 10), terminal));
      }
      if (search) query = query.or([
        "driver_name", "driver_phone", "reference_number", "mark", "shipper", "destination", "matched_order_id",
      ].map((field) => `${field}.ilike.%${search}%`).join(","));
      return query.order("checked_in_at", { ascending: false });
    };

    if (!exportFile) {
      const { data, error } = await makeQuery().range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      return NextResponse.json({ ok: true, rows: (data ?? []).map((row) => ({ ...row,
        has_bol_photo: Boolean(row.bol_photo_uploaded_at) })), hasMore: (data?.length ?? 0) === pageSize },
        { headers: { "Cache-Control": "no-store" } });
    }

    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await makeQuery().range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) break;
      if (rows.length >= 50000) return NextResponse.json({ ok: false, error: "Narrow the date range to export fewer than 50,000 rows." }, { status: 413 });
    }
    const sheet = XLSX.utils.aoa_to_sheet([
      HEADERS.map(([, label]) => label),
      ...rows.map((row) => HEADERS.map(([field]) => row[field] ?? "")),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Domestic history");
    const file = XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
    return new NextResponse(new Uint8Array(file), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="domestic-history-${terminal}-${siteCode}.xlsx"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load domestic history" }, { status: 500 });
  }
}
