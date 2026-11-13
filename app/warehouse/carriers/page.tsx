import Link from "next/link";
import { redirect } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { requireStaffPage } from "@/lib/auth/page";
import { sitesForLocation, validLocation, workspaceHref } from "@/lib/warehouse/navigation";
import { listCarrierRates } from "@/lib/warehouse/outbound/carrier-rate-store";
import CarrierRateEditor from "./CarrierRateEditor";
import "../outbound/[terminal]/[siteCode]/[id]/booking.css";

export default async function CarrierRatesPage({ searchParams }: {
  searchParams: Promise<{ terminal?: string; siteCode?: string }>;
}) {
  const staff = await requireStaffPage();
  if (staff?.role !== "admin") redirect("/access-denied");
  const location = validLocation(await searchParams);
  const sites = sitesForLocation(location).filter(site => site.materials.includes("cotton"));
  const site = location.siteCode === "all" ? undefined : sites[0];
  const result = site ? await listCarrierRates({ terminal: site.terminal, site_code: site.siteCode }) : null;
  const scope = site ? new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode }) : null;

  return <main className="warehouse-hub">
    <PlatformPageHeader compact title="Carrier rates" subtitle={site?.siteName ?? "Choose a warehouse to manage outbound carrier pay."} />
    {result?.error ? <p role="alert">Could not load carrier rates.</p> : result && scope ?
      <PlatformPanel><CarrierRateEditor key={scope.toString()} initialRates={result.data ?? []}
        endpoint={`/api/warehouse/carrier-rates?${scope}`} /></PlatformPanel> :
      <div className="warehouse-hub-grid">{sites.map(site =>
        <Link key={site.siteCode} className="warehouse-hub-card"
          href={workspaceHref("carriers", { terminal: site.terminal, siteCode: site.siteCode })}>
          <strong>{site.siteName}</strong><span className="warehouse-hub-action">Manage rates →</span>
        </Link>)}</div>}
    {!sites.length && <p>Select a cotton warehouse from the site menu.</p>}
  </main>;
}
