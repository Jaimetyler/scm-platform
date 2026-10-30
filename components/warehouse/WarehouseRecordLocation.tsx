"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { locationQuery, validLocation } from "@/lib/warehouse/navigation";

// Driver-detail URLs contain an ID, so their location comes from the fetched record.
export default function WarehouseRecordLocation({ terminal, siteCode }: { terminal: string; siteCode: string }) {
  const path = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("terminal") === terminal && params.get("siteCode") === siteCode) return;
    window.history.replaceState(null, "", `${path}?${locationQuery(validLocation({ terminal, siteCode }))}`);
  }, [path, params, terminal, siteCode]);
  return null;
}
