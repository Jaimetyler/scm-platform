import { redirect } from "next/navigation";

// Existing bookmarks now lead to the live check-in workflow.
export default function InboundPage() {
  redirect("/inbound/checkin");
}
