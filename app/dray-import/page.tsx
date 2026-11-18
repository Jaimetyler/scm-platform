import Link from "next/link";
import { redirect } from "next/navigation";
import { canUseBilling } from "@/lib/auth/policy";
import { requireStaffPage } from "@/lib/auth/page";
import ImportClient from "./ImportClient";
export const dynamic = "force-dynamic";
export default async function Page() {
  const staff = await requireStaffPage();
  if (!canUseBilling(staff)) redirect("/access-denied");
  return <>
    {staff.role === "admin" && <nav style={{maxWidth:1100,margin:"16px auto",padding:"0 24px"}}>
      <Link href="/admin/savannah-interchanges">Savannah Interchange Runs</Link>
    </nav>}
    <ImportClient />
  </>;
}
