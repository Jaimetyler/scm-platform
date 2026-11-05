import Link from "next/link";
import { redirect } from "next/navigation";
import { canUseInboundImporter } from "@/lib/auth/policy";
import { requireStaffPage } from "@/lib/auth/page";
import HoustonPreviewClient from "./HoustonPreviewClient";
import PreviewClient from "./PreviewClient";
import { inboundTerminal, inboundTerminals } from "@/lib/bunge/destinations";
import layout from "./importer.module.css";
import styles from "../cotton-locations/outreach/outreach.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ terminal?: string }>;
}) {
  const staff = await requireStaffPage();
  if (!canUseInboundImporter(staff)) redirect("/access-denied");
  const terminal = inboundTerminal((await searchParams).terminal) ?? inboundTerminals[0];

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>DOMESTIC COTTON</p>
        <h1>Inbound order importer</h1>
        <p>Review dispatch rows, warehouse mappings and proposed pickup windows</p>
      </div>
    </header>
    <nav aria-label="Inbound location" className={layout.regions}>
      {inboundTerminals.map(location => <Link key={location.id} href={`/bunge-import?terminal=${location.id}`}
        aria-current={terminal.id === location.id ? "page" : undefined}>{location.label}</Link>)}
    </nav>
    <p className={layout.notice}>Review dispatches · Rates are handled in McLeod.</p>
    {terminal.id === "houston" ? <HoustonPreviewClient /> : <PreviewClient key={terminal.id} terminal={terminal.id} />}
  </main>;
}
