import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import BrokerageDashboard from "./brokerage-dashboard";
import { staffDatabase } from "@/lib/auth/session";
import { validSnapshot } from "@/lib/reporting/broker-snapshot";

export const dynamic = "force-dynamic";

export default async function BrokerIntelligencePage() {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") redirect("/access-denied");
  const { data, error } = await staffDatabase().from("broker_intelligence_snapshots")
    .select("payload, updated_at").eq("id", "current").maybeSingle();
  if (error) console.error("Unable to load brokerage snapshot:", error);
  const snapshot = data && validSnapshot(data.payload) ? data.payload : null;
  return <BrokerageDashboard initialSnapshot={snapshot} savedAt={data?.updated_at ?? null}
    loadError={error || data && !snapshot ? "The saved snapshot could not be loaded. Refresh to try again." : ""} />;
}
