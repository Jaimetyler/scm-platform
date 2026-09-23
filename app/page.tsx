"use client";

import Link from "next/link";

const LOGO_SRC = "/scm-logo.png";

export default function Home() {
  return (
    <main style={{ maxWidth: 1320, margin: "0 auto" }}>
      {/* TOP PILL ONLY */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "5px 12px",
            borderRadius: 999,
            border: "1px solid rgba(34,211,238,0.22)",
            background: "rgba(34,211,238,0.08)",
            color: "#67e8f9",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          SCM PLATFORM
        </div>
      </div>

      {/* HERO / LOGO SECTION */}
      <section
        style={{
          marginBottom: 30,
          borderRadius: 28,
          padding: "36px 28px 42px",
          maxWidth: 1160,
          marginLeft: "auto",
          marginRight: "auto",
          background:
            "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(99,102,241,0.08) 100%)",
          border: "1px solid rgba(99,102,241,0.18)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
          textAlign: "center",
        }}
      >
        <img
          src={LOGO_SRC}
          alt="SCM Logo"
          style={{
            height: 110,
            width: "auto",
            maxWidth: "100%",
            display: "block",
            margin: "0 auto 28px",
            opacity: 0.98,
          }}
        />

        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#e5e7eb",
          }}
        >
          Internal Operations
        </div>
      </section>

      {/* NAV CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 20,
        }}
      >
        <Link href="/pnl" style={cardStyleLocked}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={cardTitle}>Profit &amp; Loss</div>
            <div style={lockStyle}>🔒</div>
          </div>

          <div style={cardDesc}>
            Financial reporting, trends, and entity breakdowns
          </div>

          <div style={lockedTagStyle}>Auth Required</div>
        </Link>

        <Link href="/inbound" style={cardStylePrimary}>
          <div style={cardTitle}>Inbound Cotton Processor</div>
          <div style={cardDesc}>
            Upload and process check-in sheets into the system
          </div>
        </Link>

        <Link href="/inbound/history" style={cardStyle}>
          <div style={cardTitle}>Inbound Cotton History</div>
          <div style={cardDesc}>Review inbound cotton records</div>
        </Link>

        <Link href="/warehouse/inventory" style={cardStylePrimary}>
          <div style={cardTitle}>Warehouse Inventory</div>
          <div style={cardDesc}>
            Review marks, bale balances, locations, and booking allocations
          </div>
        </Link>

        <Link href="/late-fees" style={cardStyle}>
          <div style={cardTitle}>Late Fees</div>
          <div style={cardDesc}>Review late fee candidates and totals</div>
        </Link>

        <Link href="/order-charges" style={cardStylePrimary}>
          <div style={cardTitle}>Billing Upload</div>
          <div style={cardDesc}>
            Upload billing details and apply charges to McLeod orders
          </div>
        </Link>
      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  borderRadius: 22,
  padding: "26px 26px 28px",
  background: "rgba(15,23,42,0.58)",
  border: "1px solid rgba(148,163,184,0.14)",
  textDecoration: "none",
  color: "#e5e7eb",
  display: "block",
  minHeight: 120,
  boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
};

const cardStylePrimary: React.CSSProperties = {
  ...cardStyle,
  border: "1px solid rgba(99,102,241,0.32)",
  background:
    "linear-gradient(135deg, rgba(79,70,229,0.16) 0%, rgba(59,130,246,0.10) 100%)",
};

const cardTitle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  marginBottom: 12,
  letterSpacing: "-0.02em",
};

const cardDesc: React.CSSProperties = {
  fontSize: 14,
  color: "#94a3b8",
  lineHeight: 1.5,
};

const cardStyleLocked: React.CSSProperties = {
  ...cardStyle,
  opacity: 0.85,
  border: "1px solid rgba(148,163,184,0.22)",
};

const lockStyle: React.CSSProperties = {
  fontSize: 18,
  opacity: 0.8,
};

const lockedTagStyle: React.CSSProperties = {
  marginTop: 14,
  fontSize: 11,
  color: "#fbbf24",
  fontWeight: 700,
  letterSpacing: "0.08em",
};
