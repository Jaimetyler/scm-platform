import { redirect } from "next/navigation";
import { canUseBilling } from "@/lib/auth/policy";
import { requireStaffPage } from "@/lib/auth/page";
import ImportClient from "./ImportClient";
export const dynamic = "force-dynamic";
export default async function Page() {
  const staff = await requireStaffPage();
  if (!canUseBilling(staff)) redirect("/access-denied");
  return <ImportClient />;
}
