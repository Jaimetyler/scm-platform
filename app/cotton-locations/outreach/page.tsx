import {requireStaffPage} from "@/lib/auth/page";
import OutreachClient from "./OutreachClient";
export const dynamic="force-dynamic";
export default async function Page(){const staff=await requireStaffPage();return <OutreachClient admin={staff.role==="admin"} canWrite={staff.role!=="viewer"}/>}
