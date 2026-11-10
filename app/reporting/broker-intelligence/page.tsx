import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import BrokerageDashboard from "./brokerage-dashboard";

export const dynamic = "force-dynamic";

export default async function BrokerIntelligencePage() {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") redirect("/access-denied");
  return <BrokerageDashboard />;
}
