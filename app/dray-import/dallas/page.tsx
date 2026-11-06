import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import DallasDrayPreview from "./DallasDrayPreview";

export const dynamic = "force-dynamic";

export default async function DallasDrayImportPage() {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") redirect("/access-denied");
  return <DallasDrayPreview />;
}
