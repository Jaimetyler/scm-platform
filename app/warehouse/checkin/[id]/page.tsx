import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

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
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: row, error } = await database().from("inbound_checkin_rows")
    .select("id, terminal, site_code, site_name, movement_direction, material_type, reference_number, destination, mark, bol_bc, checked_in_at, driver_name, driver_phone, gate_location_verified_at, driver_distance_m, bol_photo_path")
    .eq("id", id)
    .eq("checkin_source", "driver_qr")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) notFound();

  const terminalSlug = row.terminal === "HOU" ? "hou" : "sav";
  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <PlatformPageHeader
        title="Driver Check-In Details"
        subtitle={`${row.site_name} · ${row.mark || "Mark not entered"}`}
        actions={<Link href={`/inbound/checkin/${terminalSlug}/${row.site_code}`} style={buttonStyle}>← Check-In Grid</Link>}
      />
      <PlatformPanel>
        <div style={detailsGridStyle}>
          <Detail label="Driver" value={row.driver_name || "—"} />
          <Detail label="Phone" value={row.driver_phone ? <a href={`tel:${row.driver_phone}`} style={phoneStyle}>{row.driver_phone}</a> : "—"} />
          <Detail label="Movement" value={String(row.movement_direction ?? "delivery").toUpperCase()} />
          <Detail label="Material" value={String(row.material_type ?? "cotton").toUpperCase()} />
          <Detail label={row.movement_direction === "pickup" ? "McLeod BLNUM" : "McLeod consignee_refno"} value={row.reference_number || "—"} />
          {row.movement_direction === "pickup" ? <Detail label="Destination" value={row.destination || "—"} /> : null}
          <Detail label="Mark" value={row.mark || "—"} />
          {row.material_type === "cotton" ? <Detail label="Bale count on BOL" value={row.bol_bc ?? "—"} /> : null}
          <Detail label="Arrival" value={row.checked_in_at ? new Date(row.checked_in_at).toLocaleString("en-US", {
            timeZone: row.terminal === "HOU" ? "America/Chicago" : "America/New_York",
          }) : "—"} />
          <Detail label="Location verification" value={row.gate_location_verified_at ? "Verified at yard" : "Not verified"} />
          <Detail label="Distance from gate pin" value={row.driver_distance_m === null ? "—" : `${Math.round(Number(row.driver_distance_m))} meters`} />
        </div>
        {row.bol_photo_path ? (
          <a href={`/api/warehouse/checkin-bol/${row.id}`} target="_blank" rel="noreferrer" style={primaryButtonStyle}>
            Open paperwork photo
          </a>
        ) : <div style={{ color: "#64748b", marginTop: 22 }}>No paperwork photo was attached.</div>}
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
