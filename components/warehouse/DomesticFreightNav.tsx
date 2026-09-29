import Link from "next/link";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import type { CSSProperties } from "react";

type View = "line" | "cotton" | "domestic" | "history";

export default function DomesticFreightNav({ terminalSlug, siteCode, current }: {
  terminalSlug: string; siteCode: string; current: View;
}) {
  const site = getCheckinSite(terminalSlug, siteCode);
  const base = `/warehouse/gate/${terminalSlug}/${siteCode}`;
  const views: { key: View; label: string; href: string }[] = [
    { key: "line", label: "Domestic Line", href: `${base}/line` },
    ...(site?.materials.includes("cotton") ? [{ key: "cotton" as const, label: "Cotton", href: `/inbound/checkin/${terminalSlug}/${siteCode}` }] : []),
    ...(site?.materials.includes("lumber") ? [{ key: "domestic" as const, label: "Lumber & Other", href: `${base}/domestic` }] : []),
    { key: "history", label: "Domestic History", href: `${base}/history` },
  ];
  return <nav aria-label="Domestic freight views" style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
    {views.map((view) => current === view.key
      ? <span key={view.key} aria-current="page" style={activeStyle}>{view.label}</span>
      : <Link key={view.key} href={view.href} style={tabStyle}>{view.label}</Link>)}
  </nav>;
}

const tabStyle: CSSProperties = {
  padding: "9px 13px", borderRadius: 8, border: "1px solid #334155",
  color: "#cbd5e1", background: "#0f172a", fontSize: 13, fontWeight: 700, textDecoration: "none",
};
const activeStyle: CSSProperties = { ...tabStyle, borderColor: "#6366f1", color: "#fff", background: "#4338ca" };
