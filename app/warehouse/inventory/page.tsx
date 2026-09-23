import Link from "next/link";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export default function InventorySiteSelector() {
  return (
    <main style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PlatformPageHeader
        title="Warehouse Inventory"
        subtitle="Choose a warehouse to review current cotton inventory, locations, booking allocations, and receipt status."
        actions={<>
          <Link href="/warehouse/gate" style={buttonStyle}>Driver QR Setup</Link>
          <Link href="/" style={buttonStyle}>← Back Home</Link>
        </>}
      />

      {(["SAV", "HOU"] as const).map((terminal) => (
        <PlatformPanel key={terminal}>
          <div style={{ color: "#67e8f9", fontSize: 12, fontWeight: 900, letterSpacing: ".16em", marginBottom: 12 }}>
            {terminal === "SAV" ? "SAVANNAH" : "HOUSTON"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 360px))", gap: 14 }}>
            {CHECKIN_SITES.filter((site) => site.terminal === terminal).map((site) => (
              <Link key={site.siteCode}
                href={`/warehouse/inventory/${site.terminalSlug}/${site.siteCode}`}
                style={siteCardStyle}>
                <div style={{ color: "#f8fafc", fontSize: 21, fontWeight: 900 }}>{site.siteName}</div>
                <div style={{ color: "#94a3b8", marginTop: 8, fontSize: 13 }}>
                  Sub-locations: {site.subLocations.join(", ")}
                </div>
              </Link>
            ))}
          </div>
        </PlatformPanel>
      ))}
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "11px 15px", borderRadius: 10, border: "1px solid rgba(148,163,184,.24)",
  background: "rgba(15,23,42,.85)", color: "#e2e8f0", fontWeight: 800,
};

const siteCardStyle: React.CSSProperties = {
  display: "block", padding: 18, borderRadius: 16,
  border: "1px solid rgba(99,102,241,.28)",
  background: "linear-gradient(135deg, rgba(79,70,229,.14), rgba(15,23,42,.82))",
};
