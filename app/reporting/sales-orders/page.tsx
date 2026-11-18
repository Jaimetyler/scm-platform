import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page";
import SalesOrders from "./sales-orders";

export const dynamic = "force-dynamic";

export default async function Page() {
  const staff = await requireStaffPage();
  if (staff.role !== "admin") notFound();
  return <SalesOrders />;
}
