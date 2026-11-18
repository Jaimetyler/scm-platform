import { salesOrdersEnabled } from "@/lib/reporting/sales-orders-state";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import styles from "./sales-orders.module.css";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import SalesOrders from "./sales-orders";

export const dynamic = "force-dynamic";

export default async function Page() {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") notFound();
  if (!salesOrdersEnabled()) return (
    <main className={styles.page}>
      <PlatformPageHeader compact title="Sales Orders & Margin" subtitle="Coming soon" />
      <p>Sales reporting is paused while the McLeod SQL connection is being set up.</p>
    </main>
  );
  return <SalesOrders />;
}
