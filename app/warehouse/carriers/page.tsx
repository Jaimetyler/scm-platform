import Link from "next/link";
import { redirect } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import { requireStaffPage } from "@/lib/auth/page";
import { locationQuery, sitesForLocation, validLocation, workspaceHref } from "@/lib/warehouse/navigation";
import { listCarrierRates } from "@/lib/warehouse/outbound/carrier-rate-store";
import CarrierRateEditor from "./CarrierRateEditor";
import "../outbound/[terminal]/[siteCode]/[id]/booking.css";

export default async function CarrierRatesPage({ searchParams }: {
  searchParams: Promise<{ terminal?: string; siteCode?: string; rateType?: string }>;
}) {
  const staff = await requireStaffPage();
  if (staff?.role !== "admin") redirect("/access-denied");
  const query = await searchParams;
  const location = validLocation(query);
  const transit = query.rateType === "inbound";
  const transitQuery = locationQuery(location);
  transitQuery.set("rateType", "inbound");
  const sites = sitesForLocation(location).filter(site => site.materials.includes("cotton"));
  const site = location.siteCode === "all" ? undefined : sites[0];
  const result = site && !transit ? await listCarrierRates({ terminal: site.terminal, site_code: site.siteCode }) : null;
  const scope = site ? new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode }) : null;

  return <main className="warehouse-hub">
    <PlatformPageHeader compact title="Carrier Rates" subtitle={site?.siteName ?? "Choose a warehouse to manage local dray rates."} />
    <nav className="warehouse-main-nav" aria-label="Carrier rate categories" style={{ marginBottom: 12 }}>
      <Link href={workspaceHref("carriers", location)} aria-current={!transit ? "page" : undefined}>Local Dray Rates</Link>
      <Link href={`/warehouse/carriers?${transitQuery}`} aria-current={transit ? "page" : undefined}>Transit Inbound Rates</Link>
    </nav>
    {transit ? <section className="warehouse-empty-state">
      <h2>Transit Inbound Rates</h2>
      <p>Flat carrier pay per load by pickup city, state, and delivery warehouse. Rate entry and import are pending.</p>
    </section> : <>
    {result?.error ? <p role="alert">Could not load carrier rates.</p> : result && scope && site ?
      <CarrierRateEditor key={scope.toString()} initialRates={result.data ?? []} warehouse={site.displayCode ?? site.siteCode}
        endpoint={`/api/warehouse/carrier-rates?${scope}`} /> :
      <div className="warehouse-hub-grid">{sites.map(site =>
        <Link key={site.siteCode} className="warehouse-hub-card"
          href={workspaceHref("carriers", { terminal: site.terminal, siteCode: site.siteCode })}>
          <strong>{site.siteName}</strong><span className="warehouse-hub-action">Manage rates →</span>
        </Link>)}</div>}
    {!sites.length && <p>Select a cotton warehouse from the site menu.</p>}
    </>}
  </main>;
}
