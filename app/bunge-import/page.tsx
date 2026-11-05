import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import HoustonPreviewClient from "./HoustonPreviewClient";
import PreviewClient from "./PreviewClient";
import layout from "./importer.module.css";
import styles from "../cotton-locations/outreach/outreach.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ terminal?: string }>;
}) {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") redirect("/access-denied");
  const houston = (await searchParams).terminal === "houston";

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>DOMESTIC COTTON</p>
        <h1>Bunge order preview</h1>
        <p>Review dispatch rows, warehouse mappings and proposed pickup windows</p>
      </div>
      <Link href="/">Platform home</Link>
    </header>
    <nav aria-label="Bunge dispatch region" className={layout.regions}>
      <Link href="/bunge-import" aria-current={houston ? undefined : "page"}>Savannah / Dallas</Link>
      <Link href="/bunge-import?terminal=houston" aria-current={houston ? "page" : undefined}>Houston</Link>
    </nav>
    <p className={layout.notice}>Preview only · McLeod creation, rating and delivery are disabled.</p>
    {houston ? <HoustonPreviewClient /> : <PreviewClient />}
  </main>;
}
