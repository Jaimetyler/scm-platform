import TransitRateGrid from "../rates/TransitRateGrid";
import Link from "next/link";
import { redirect } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import { requireStaffPage } from "@/lib/auth/page";
import { locationQuery, validLocation, workspaceHref } from "@/lib/warehouse/navigation";
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
  const result = transit ? null : await listCarrierRates(null);

  return <main className="warehouse-hub">
    <PlatformPageHeader compact title="Carrier Rates" />
    <nav className="warehouse-main-nav" aria-label="Carrier rate categories" style={{ marginBottom: 12 }}>
      <Link href={workspaceHref("carriers", location)} aria-current={!transit ? "page" : undefined}>Local Dray Rates</Link>
      <Link href={`/warehouse/carriers?${transitQuery}`} aria-current={transit ? "page" : undefined}>Transit Inbound Rates</Link>
    </nav>
    {transit ? <TransitRateGrid side="carrier" /> : <>
    {result?.error ? <p role="alert">Could not load local dray rates.</p> :
      <CarrierRateEditor key={locationQuery(location).toString()} initialRates={result?.data ?? []} location={location} />}
    </>}
  </main>;
}
