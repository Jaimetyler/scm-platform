import React from "react";

type PlatformPageHeaderProps = {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: React.ReactNode;
};

export default function PlatformPageHeader({
  title,
  subtitle,
  badge = "SCM PLATFORM",
  actions,
}: PlatformPageHeaderProps) {
  return (
    <section
      style={{
        marginBottom: 22,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 520px" }}>
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
            marginBottom: 16,
          }}
        >
          {badge}
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 42,
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "#f8fafc",
          }}
        >
          {title}
        </h1>

        {subtitle ? (
          <p
            style={{
              margin: "10px 0 0",
              color: "#94a3b8",
              fontSize: 15,
              maxWidth: 760,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          {actions}
        </div>
      ) : null}
    </section>
  );
}