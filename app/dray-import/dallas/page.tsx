import { redirect } from "next/navigation";
import { canUseBilling } from "@/lib/auth/policy";
import { requireStaffPage } from "@/lib/auth/page";
import DallasDrayPreview from "./DallasDrayPreview";

export const dynamic = "force-dynamic";

export default async function DallasDrayImportPage() {
  const staff = await requireStaffPage();
  if (!canUseBilling(staff)) redirect("/access-denied");
  return <DallasDrayPreview />;
}
