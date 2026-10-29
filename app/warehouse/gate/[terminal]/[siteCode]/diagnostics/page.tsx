import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { requireStaffPage } from "@/lib/auth/page";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";

export const dynamic = "force-dynamic";
export default async function CheckinDiagnostics({ params }: { params: Promise<{ terminal: string; siteCode: string }> }) {
  const staff = await requireStaffPage();
  const route = await params;
  const site = getCheckinSite(route.terminal, route.siteCode);
  if (!site || staff.role === "operator" && staff.terminal !== site.terminal) notFound();
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  const { data, error } = await createClient(url,key).from("inbound_checkin_rows")
    .select("id,checked_in_at,physical_departed_at,yard_status,draft_status,reference_number,mark,driver_name,mcleod_lookup_status,outside_carrier_override_at,outside_carrier_override_reason,processing_error")
    .eq("terminal",site.terminal).eq("site_code",site.siteCode)
    .or("physical_departed_at.not.is.null,and(yard_status.eq.completed,mcleod_lookup_status.eq.unresolved)")
    .order("checked_in_at",{ascending:false}).limit(200);
  if (error) throw new Error("Could not load check-in diagnostics");
  const departed = (data || []).filter(row => row.physical_departed_at && !["completed","cancelled"].includes(row.yard_status));
  const unresolved = (data || []).filter(row => row.yard_status === "completed" && row.outside_carrier_override_at && row.mcleod_lookup_status === "unresolved");
  const time = (value: string) => new Date(value).toLocaleString("en-US",{timeZone:site.terminal === "HOU" ? "America/Chicago" : "America/New_York"});
  const entry = (row: NonNullable<typeof data>[number]) => <li key={row.id} style={{ marginTop: 14 }}>
    <Link href={`/warehouse/checkin/${row.id}`} style={{ color: "#67e8f9" }}>{row.reference_number || row.mark || "Arrival"} · {row.driver_name || "Staff entry"}</Link>
    {row.physical_departed_at && <p>Departed {time(row.physical_departed_at)}</p>}
    {row.outside_carrier_override_reason && <p>{row.outside_carrier_override_reason}</p>}
    {row.processing_error && <p>{row.processing_error}</p>}
  </li>;
  return <main style={{ maxWidth: 960, margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title={`${site.siteName} Check-In Diagnostics`} subtitle="Recent reconciliation records, kept separate from the Active Line." />
    <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/history`} style={{ color: "#67e8f9" }}>Back to history</Link>
    <p>Showing the latest 200 matching arrivals. These records do not count as active trucks. No McLeod updates are sent from this page.</p>
    <details style={panel}><summary>Departed trucks · McLeod reconciliation ({departed.length})</summary>
      <p>McLeod completion still needs verification. Review the saved state before any retry; do not send a duplicate delivery update.</p><ul>{departed.map(entry)}</ul>
    </details>
    <details style={panel}><summary>Completed movements · SCM verification unresolved ({unresolved.length})</summary><ul>{unresolved.map(entry)}</ul></details>
  </main>;
}
const panel: React.CSSProperties = { padding: 18, marginTop: 18, border: "1px solid #475569", borderRadius: 10 };
