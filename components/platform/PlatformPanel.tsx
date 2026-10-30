import React from "react";

export default function PlatformPanel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        border: "1px solid rgba(148,163,184,0.16)",
        borderRadius: 22,
        padding: 24,
        marginBottom: 22,
        background: "rgba(15,23,42,0.72)",
        boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        backdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}