import Link from "next/link";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export default function InboundCheckinSelectorPage() {
  const savSites = CHECKIN_SITES.filter((site) => site.terminal === "SAV");
  const houSites = CHECKIN_SITES.filter((site) => site.terminal === "HOU");

  return (
    <main style={{ maxWidth: 1560, margin: "0 auto" }}>
      <PlatformPageHeader
        title="Check-In Sheets"
        subtitle="Choose a site. Terminal and site are set automatically on the check-in page."
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={linkButtonStyle}>
              ← Back Home
            </Link>

            <Link href="/inbound" style={linkButtonStyle}>
              Back to Inbound
            </Link>
          </div>
        }
      />

      <div style={{ display: "grid", gap: 18 }}>
        <PlatformPanel>
          <div style={{ marginBottom: 16 }}>
            <div style={sectionEyebrowStyle}>Savannah</div>
            <h2 style={sectionTitleStyle}>Savannah Sites</h2>
          </div>

          <div style={cardGridStyle}>
            {savSites.map((site) => (
              <Link
                key={`${site.terminalSlug}-${site.siteCode}`}
                href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`}
                style={siteCardStyle}
              >
                <div style={siteCodeStyle}>{site.siteCode}</div>
                <div style={siteNameStyle}>{site.siteName}</div>
                <div style={siteMetaStyle}>
                  Sub-locations: {site.subLocations.join(", ")}
                </div>
              </Link>
            ))}
          </div>
        </PlatformPanel>

        <PlatformPanel>
          <div style={{ marginBottom: 16 }}>
            <div style={sectionEyebrowStyle}>Houston</div>
            <h2 style={sectionTitleStyle}>Houston Sites</h2>
          </div>

          <div style={cardGridStyle}>
            {houSites.map((site) => (
              <Link
                key={`${site.terminalSlug}-${site.siteCode}`}
                href={`/inbound/checkin/${site.terminalSlug}/${site.siteCode}`}
                style={siteCardStyle}
              >
                <div style={siteCodeStyle}>{site.siteCode}</div>
                <div style={siteNameStyle}>{site.siteName}</div>
                <div style={siteMetaStyle}>
                  Sub-locations: {site.subLocations.join(", ")}
                </div>
              </Link>
            ))}
          </div>
        </PlatformPanel>
      </div>
    </main>
  );
}

const sectionEyebrowStyle: React.CSSProperties = {
  color: "#67e8f9",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  marginBottom: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f8fafc",
  fontSize: 26,
  fontWeight: 800,
};

const cardGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 380px))",
  gap: 14,
  justifyContent: "start",
};

const siteCardStyle: React.CSSProperties = {
  display: "block",
  padding: 18,
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.84) 0%, rgba(2,6,23,0.9) 100%)",
  textDecoration: "none",
  boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
};

const siteCodeStyle: React.CSSProperties = {
  color: "#67e8f9",
  fontSize: 28,
  fontWeight: 900,
  lineHeight: 1,
  marginBottom: 10,
};

const siteNameStyle: React.CSSProperties = {
  color: "#f8fafc",
  fontSize: 18,
  fontWeight: 800,
  marginBottom: 8,
};

const siteMetaStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 13,
  lineHeight: 1.45,
};

const linkButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(15,23,42,0.84)",
  color: "#e2e8f0",
  cursor: "pointer",
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
};