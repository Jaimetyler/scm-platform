import { readBookingSource, BOOKING_UPLOAD_BUCKET } from "@/lib/warehouse/outbound/booking-source";
import { staffDatabase } from "@/lib/auth/session";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";

import { planOutboundDrayLoads } from "@/lib/dray/outbound-load-plan";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { vendor } from "@/lib/dray/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = withStaffAccess(async (request: NextRequest) => {
  try {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = await request.json();
      const bookingNumber = String(input.bookingNumber ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9_/-]{3,40}$/.test(bookingNumber)) throw Error("Enter a valid booking number.");
      normalizeBookingDetails(input.details ?? {});
      const loads = planOutboundDrayLoads(String(input.bookId ?? ""), input.containers, input.pickup, input.delivery);
      const prefix = loads[0].originalBlnum.slice(0, -1);
      const [bookings, orders] = await Promise.all([
        staffDatabase().from("cotton_outbound_bookings").select("site_name,status")
          .eq("terminal", "DAL").eq("booking_number", bookingNumber),
        (async () => {
          const read = vendor(true).read;
          const found = new Map<string, { id: string; blnum: string }>();
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(75_000)]);
          for (let offset = 0; offset < 600; offset += 25) {
            signal.throwIfAborted();
            const query = new URLSearchParams({ "orders.blnum": prefix + "*",
              "orders.revenue_code_id": "DDRAY", recordLength: "25", recordOffset: String(offset) });
            const page = extractSearchOrders(await read(`/orders/search?${query}`));
            if (!page || page.length > 25) throw Error("McLeod duplicate check returned an incomplete result.");
            for (const row of page as Record<string, unknown>[]) {
              const id = String(row?.id ?? "");
              const blnum = String(row?.blnum ?? "").trim().toUpperCase();
              if (!id || !blnum || found.has(id)) throw Error("McLeod duplicate check returned incomplete or repeated orders.");
              found.set(id, { id, blnum });
            }
            if (page.length < 25) return [...found.values()].filter(order =>
              order.blnum.startsWith(prefix) && /^\d+$/.test(order.blnum.slice(prefix.length)));
          }
          throw Error("Too many McLeod orders to complete the duplicate check.");
        })(),
      ]);
      if (bookings.error) throw Error("Could not check platform bookings.");
      return NextResponse.json({ bookings: bookings.data.map(row => `${row.site_name} (${row.status})`), orders },
        { headers: { "Cache-Control": "private, no-store" } });
    }
    const form = await request.formData();
    const source = await readBookingSource(form, { owner: staffProfile(request)?.user_id ?? "", terminal: "DAL",
      secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", download: path => staffDatabase().storage.from(BOOKING_UPLOAD_BUCKET).download(path) }, "booking");
    const preview = previewDallasBungeDrays(source.bytes);
    return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Booking could not be read.";
    return NextResponse.json({ ok: false, error: message.startsWith("McLeod HTTP") ? "McLeod duplicate check is unavailable." : message }, { status: 400 });
  }
});
