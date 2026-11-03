import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import ImportClient from "./ImportClient";
export const dynamic = "force-dynamic";
export default async function Page() {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") redirect("/access-denied");
  return <ImportClient />;
}
