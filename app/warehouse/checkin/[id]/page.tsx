import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/page";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import WarehouseRecordLocation from "@/components/warehouse/WarehouseRecordLocation";

import ShortageNotice from "@/components/warehouse/ShortageNotice";

export const dynamic = "force-dynamic";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

export default async function DriverCheckinDetailsPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const staff = await requireStaffPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: row, error } = await database().from("inbound_checkin_rows")
    .select("id, terminal, site_code, site_name, movement_direction, material_type, reference_number, destination, mark, bol_bc, bale_count, expected_bale_count, driver_reported_bales, shortage_acknowledged_at, shortage_acknowledged_by, shortage_expected_bales, shortage_received_bales, shortage_note, customer_notified_at, customer_notified_by, comment_1, comment_2, matched_order_id, checked_in_at, driver_name, driver_phone, trucking_company, gate_location_verified_at, driver_distance_m, bol_photo_path, pickup_agreement, trailer_number")
    .eq("id", id)
    .eq("checkin_source", "driver_qr")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || staff.role === "operator" && row.terminal !== staff.terminal) notFound();

  const terminalSlug = row.terminal === "HOU" ? "hou" : "sav";
  const isCotton = row.material_type === "cotton";
  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <WarehouseRecordLocation terminal={row.terminal} siteCode={row.site_code} />
      <PlatformPageHeader
        title="Driver Check-In Details"
        subtitle={`${row.site_name} · ${isCotton ? row.mark || "Mark not entered" : row.reference_number || "Reference not entered"}`}
        actions={<Link href={isCotton ? `/inbound/checkin/${terminalSlug}/${row.site_code}` : `/warehouse/gate/${terminalSlug}/${row.site_code}/domestic`} style={buttonStyle}>← {isCotton ? "Cotton grid" : "Lumber & Other"}</Link>}
      />
      <PlatformPanel>
        <ShortageNotice row={row} />
        <div style={detailsGridStyle}>
          <Detail label="Driver" value={row.driver_name || "—"} />
          <Detail label="Trailer number" value={row.trailer_number || row.pickup_agreement?.trailerNumber || "—"} />
          <Detail label="Trucking company" value={row.trucking_company || "—"} />
          <Detail label="Phone" value={row.driver_phone ? <a href={`tel:${row.driver_phone}`} style={phoneStyle}>{row.driver_phone}</a> : "—"} />
          <Detail label="SCM order number" value={row.matched_order_id || "—"} />
          <Detail label="Material" value={String(row.material_type ?? "cotton").toUpperCase()} />
          {!isCotton && <Detail label={row.movement_direction === "pickup" ? "BOL number" : "Consignee reference"} value={row.reference_number || "—"} />}
          {row.movement_direction === "pickup" ? <Detail label="Destination" value={row.destination || "—"} /> : null}
          {isCotton && <Detail label="Mark" value={row.mark || "—"} />}
          {isCotton && <Detail label="Bale count on BOL" value={row.bol_bc ?? "—"} />}
          <Detail label="Arrival" value={row.checked_in_at ? new Date(row.checked_in_at).toLocaleString("en-US", {
            timeZone: row.terminal === "HOU" ? "America/Chicago" : "America/New_York",
          }) : "—"} />
          <Detail label="Location verification" value={row.gate_location_verified_at ? "Verified at yard" : "Not verified"} />
          <Detail label="Distance from gate pin" value={row.driver_distance_m === null ? "—" : `${Math.round(Number(row.driver_distance_m))} meters`} />
        </div>
        <p style={{ whiteSpace: "pre-wrap", color: "#cbd5e1" }}>{[row.comment_1, row.comment_2].filter(Boolean).join("\n")}</p>
        {row.bol_photo_path ? (
          <a href={`/api/warehouse/checkin-bol/${row.id}`} target="_blank" rel="noreferrer" style={primaryButtonStyle}>
            Open paperwork photo
          </a>
        ) : <div style={{ color: "#64748b", marginTop: 22 }}>No paperwork photo was attached.</div>}
        {row.pickup_agreement ? <section style={{ color: "#e2e8f0", marginTop: 24 }}>
          <h2>Signed pickup agreement</h2>
          <p>{row.pickup_agreement.version} · {row.pickup_agreement.language === "es" ? "Español" : "English"} · {row.pickup_agreement.acceptedAt}</p>
          <p>Driver: {row.pickup_agreement.printedName} · Carrier: {row.pickup_agreement.truckingCompany} · Trailer: {row.pickup_agreement.trailerNumber}</p>
          <p>Pickup: {row.pickup_agreement.pickupNumber} · Reference / PO: {row.pickup_agreement.referencePo}</p>
          <p>Product: {row.pickup_agreement.productDescription} · Destination: {row.pickup_agreement.destination}</p>
          <h3>{row.pickup_agreement.terms.title}</h3><p>{row.pickup_agreement.terms.introduction}</p>
          <ol>{row.pickup_agreement.terms.clauses.map((text: string, i: number) => <li key={i}>{text}</li>)}</ol>
          <p>{row.pickup_agreement.terms.acknowledgment}</p><p>{row.pickup_agreement.terms.consent}</p>
          <svg role="img" aria-label="Saved driver signature" viewBox="0 0 600 180" style={{ width: "100%", maxWidth: 600, background: "white" }}>
            {row.pickup_agreement.strokes.map((stroke: [number, number][], i: number) => <polyline key={i} points={stroke.map(([x,y]) => `${x*600},${y*180}`).join(" ")} fill="none" stroke="#111827" strokeWidth="2" />)}
          </svg>
        </section> : row.movement_direction === "pickup" ? <p>No electronic pickup agreement is recorded. Keep the signed paper form.</p> : null}
      </PlatformPanel>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div style={{ padding: 14, borderRadius: 12, background: "rgba(15,23,42,.7)", border: "1px solid rgba(148,163,184,.14)" }}>
    <div style={{ color: "#64748b", fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</div>
    <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginTop: 7 }}>{value}</div>
  </div>;
}

const detailsGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };
const buttonStyle: React.CSSProperties = { padding: "11px 15px", borderRadius: 10, border: "1px solid rgba(148,163,184,.24)", background: "rgba(15,23,42,.85)", color: "#e2e8f0", fontWeight: 800 };
const primaryButtonStyle: React.CSSProperties = { display: "inline-block", marginTop: 22, padding: "12px 16px", borderRadius: 10, background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white", fontWeight: 900 };
const phoneStyle: React.CSSProperties = { color: "#67e8f9", textDecoration: "underline" };
