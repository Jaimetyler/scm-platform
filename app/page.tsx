import Link from "next/link";
import { canUseBilling, canUseInboundImporter, canViewLateFees } from "@/lib/auth/policy";
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
      <h3 className={styles.cardTitle}>{title}</h3>
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
      <nav className={styles.sections} aria-label="Platform tools">
        <section aria-labelledby="operations-title">
          <div className={styles.sectionHeading}><div><h2 id="operations-title">Operations</h2><p>Daily warehouse activity, dispatch and location information.</p></div></div>
          <div className={styles.grid}>
            <ToolCard href="/warehouse" category="Operations" title="Warehouse" description="View check-ins, inventory, outbound bookings and history across all terminals." />
            <ToolCard href="/warehouse/rates" category="Operations" title="Rates" description="View, edit and import customer rates and chassis allowances." />
            <ToolCard href="/cotton-locations" category="Operations" title="Cotton Locations" description="Find pickup hours, tariff documents and fees by location." />
            {canViewLateFees(staff) && <ToolCard href="/late-fees" category="Operations" title="Late Fees" description="Review late-fee candidates, active loads and totals by office." />}
          </div>
        </section>
        {(billing || canUseInboundImporter(staff)) && <section aria-labelledby="billing-title">
          <div className={styles.sectionHeading}><div><h2 id="billing-title">Importing &amp; Billing</h2><p>Import reports, create and rate orders, and apply billing details.</p></div></div>
          <div className={styles.grid}>
            {canUseInboundImporter(staff) && <ToolCard href="/bunge-import" category="Importing" title="Inbound Cotton Importer" description="Review dispatches, warehouse mappings and pickup windows for all three terminals." />}
            {billing && <>
            <ToolCard href="/ecotton-import" category="Importing" title="eCotton Order Import" description="Review warehouse reports, check duplicates, and create and rate orders." />
            <ToolCard href="/ecotton-import?source=gin-direct" category="Importing" title="Gin Direct Invoice Import" description="Upload invoice PDFs to create, rate, and deliver eCotton orders." />
            <ToolCard href="/dray-import" category="Importing" title="Savannah Dray Import" description="Match FirstStar carrier pay, review billing and deliver orders." />
            <ToolCard href="/dray-import/dallas" category="Importing" title="Dallas Dray Import" description="Preview planned rail drays from customer booking requests." />
            <ToolCard href="/order-charges" category="Billing" title="Billing Upload" description="Upload billing details and apply charges to SCM orders." />
            </>}
          </div>
        </section>}
        {admin && <section aria-labelledby="reporting-title">
          <div className={styles.sectionHeading}><div><h2 id="reporting-title">Reporting</h2><p>Financial performance and business analysis.</p></div></div>
          <div className={styles.grid}>
            <ToolCard href="/reporting/broker-intelligence" category="Reporting" title="Broker Intelligence" description="Review brokerage team workload, customer assignments, financial contribution and seasonal demand." restricted />
            <ToolCard href="/pnl" category="Reporting" title="Profit & Loss" description="Explore financial results, trends and entity breakdowns." restricted />
            <ToolCard href="/reporting/business-intelligence" category="Reporting" title="SCM Business Intelligence" description="Compare customers, warehouse services and trucking across business units." restricted />
          </div>
        </section>}
      </nav>
    </main>
  );
}

