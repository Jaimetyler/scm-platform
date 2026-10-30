"use client";

import Link from "next/link";

const LOGO_SRC = "/scm-logo.png";

function OfficeCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          border: "1px solid rgba(148,163,184,0.16)",
          borderRadius: 20,
          padding: 22,
          background: "rgba(15,23,42,0.75)",
          minHeight: 170,
          transition: "transform 0.15s ease, border-color 0.15s ease",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "5px 10px",
            borderRadius: 999,
            border: "1px solid rgba(34,211,238,0.22)",
            background: "rgba(34,211,238,0.08)",
            color: "#67e8f9",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Late Fees
        </div>

        <h2 style={{ margin: "0 0 10px", fontSize: 26, color: "#f8fafc" }}>{title}</h2>

        <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.5 }}>{description}</p>
      </div>
    </Link>
  );
}

export default function LateFeesLandingPage() {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 26 }}>
       

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
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
          SCM Platform
        </div>

        <Link
          href="/"
          style={{
            marginLeft: "auto",
            textDecoration: "none",
            color: "#e5e7eb",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          Back Home
        </Link>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 34, color: "#f8fafc" }}>Late Fees</h1>
        <p style={{ margin: "10px 0 0", color: "#94a3b8", fontSize: 16 }}>
          Choose an office to view late-fee exposure and active loads.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
        }}
      >
        <OfficeCard
          href="/late-fees/savannah"
          title="Savannah Office"
          description="View Savannah late-fee exposure, bale counts, delivery dates, and active late loads."
        />

        <OfficeCard
          href="/late-fees/dallas"
          title="Dallas Office"
          description="View Dallas late-fee exposure, bale counts, delivery dates, and active late loads."
        />
      </div>
    </main>
  );
}