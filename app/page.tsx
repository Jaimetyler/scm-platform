import Link from "next/link";
import { canUseBilling, canUseInboundImporter } from "@/lib/auth/policy";
import { requireStaffPage } from "@/lib/auth/page";
import styles from "./home.module.css";

type ToolCardProps = {
  href: string;
  title: string;
  description: string;
  category: string;
  restricted?: boolean;
};

function ToolCard({ href, title, description, category, restricted = false }: ToolCardProps) {
  return (
    <Link href={href} className={`${styles.card} ${restricted ? styles.reporting : ""}`}>
      <div className={styles.cardTop}>
        <span className={styles.category}>{category}</span>
        {restricted && <span className={styles.access}>Admin</span>}
      </div>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardDescription}>{description}</p>
      <div className={styles.cardAction}>
        <span>{category === "Reporting" ? "View report" : "Open tool"}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </Link>
  );
}

export default async function Home() {
  const staff = await requireStaffPage();
  const admin = staff.role === "admin";
  const billing = canUseBilling(staff);
  return (
    <main className={styles.page}>
      <div className={styles.platformLabel}>SCM Platform</div>
      <section className={styles.hero}>
        <img src="/scm-logo.png" alt="SCM Supply Chain Management LLC" className={styles.logo} />
        <h1>{admin ? "Internal Operations" : staff.role === "accounting" ? "Accounting" : "Dispatch Operations"}</h1>
      </section>
      <nav className={styles.grid} aria-label="Platform tools">
        {canUseInboundImporter(staff) && <ToolCard href="/bunge-import" category="Importing" title="Inbound Order Importer" description="Review dispatches, warehouse mappings and pickup windows for all three terminals." />}
        <ToolCard href="/cotton-locations" category="Locations" title="Cotton Locations" description="Find pickup hours, tariff documents and fees by location." />
        {billing && <>
          <ToolCard href="/dray-import" category="Importing" title="Savannah Dray Import" description="Match FirstStar carrier pay, review billing and deliver orders." />
          <ToolCard href="/dray-import/dallas" category="Importing" title="Dallas Dray Import" description="Preview planned rail drays from customer booking requests." />
        </>}
        {admin && <>
          <ToolCard href="/pnl" category="Reporting" title="Profit & Loss" description="Explore financial results, trends and entity breakdowns." restricted />
          <ToolCard href="/reporting/business-intelligence" category="Reporting" title="SCM Business Intelligence" description="Compare customers, warehouse services and trucking across business units." restricted />
        </>}
        <ToolCard href="/warehouse" category="Operations" title="Warehouse" description="View check-ins, inventory, outbound bookings and history across all terminals." />
        {billing && <>
          <ToolCard href="/late-fees" category="Billing" title="Late Fees" description="Review late-fee candidates, active loads and totals by office." />
          <ToolCard href="/ecotton-import" category="Importing" title="eCotton Order Import" description="Review warehouse reports, check duplicates, and create and rate orders." />
          <ToolCard href="/order-charges" category="Billing" title="Billing Upload" description="Upload billing details and apply charges to SCM orders." />
        </>}
      </nav>
    </main>
  );
}
