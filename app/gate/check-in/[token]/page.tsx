"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Site = { terminal: "SAV" | "HOU"; siteCode: string; siteName: string };

type FormState = {
  driverName: string;
  driverPhone: string;
  truckingCompany: string;
  mark: string;
  shipper: string;
  bolBC: string;
  baleCount: string;
  equipmentType: string;
  comment: string;
};

const EMPTY_FORM: FormState = {
  driverName: "", driverPhone: "", truckingCompany: "", mark: "", shipper: "",
  bolBC: "", baleCount: "", equipmentType: "", comment: "",
};

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This phone does not support location services."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    });
  });
}

export default function DriverCheckinPage() {
  const { token } = useParams<{ token: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [clientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/gate/check-in/${token}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "This check-in link is unavailable");
        if (!cancelled) setSite(result.site);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "This check-in link is unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token]);

  function change(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!site || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const position = await currentPosition();
      const response = await fetch(`/api/gate/check-in/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          clientId,
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Check-in failed");
      setComplete(true);
    } catch (reason) {
      if (typeof reason === "object" && reason !== null && "code" in reason) {
        const code = Number((reason as { code: unknown }).code);
        const message = code === 1
          ? "Location permission is required. Allow location access for this site and try again."
          : "Your phone could not get an accurate location. Move into an open area and try again.";
        setError(message);
      } else {
        setError(reason instanceof Error ? reason.message : "Check-in failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main style={shellStyle}><div style={cardStyle}>Loading check-in…</div></main>;
  if (!site) return <main style={shellStyle}><div style={cardStyle}><h1 style={titleStyle}>Check-In Unavailable</h1><p style={errorStyle}>{error}</p></div></main>;
  if (complete) return (
    <main style={shellStyle}>
      <div style={{ ...cardStyle, textAlign: "center" }}>
        <div style={{ fontSize: 54, marginBottom: 12 }}>✓</div>
        <h1 style={titleStyle}>You’re checked in</h1>
        <p style={bodyStyle}>Your arrival was sent to {site.siteName}. Warehouse staff can now see your load.</p>
        <p style={{ ...bodyStyle, color: "#67e8f9", fontWeight: 800 }}>Please follow the yard’s instructions and wait for direction.</p>
      </div>
    </main>
  );

  return (
    <main style={shellStyle}>
      <form onSubmit={submit} style={cardStyle}>
        <div style={badgeStyle}>SCM DRIVER CHECK-IN</div>
        <h1 style={titleStyle}>{site.siteName}</h1>
        <p style={bodyStyle}>Enter your load information. When you submit, your phone will verify that you are at the yard.</p>

        <div style={gridStyle}>
          <Field label="Driver name *" value={form.driverName} onChange={(value) => change("driverName", value)} autoComplete="name" />
          <Field label="Mobile number" value={form.driverPhone} onChange={(value) => change("driverPhone", value)} autoComplete="tel" inputMode="tel" />
          <Field label="Trucking company *" value={form.truckingCompany} onChange={(value) => change("truckingCompany", value)} />
          <Field label="Mark *" value={form.mark} onChange={(value) => change("mark", value.toUpperCase())} autoCapitalize="characters" />
          <Field label="Customer *" value={form.shipper} onChange={(value) => change("shipper", value.toUpperCase())} autoCapitalize="characters" />
          <Field label="BOL B/C *" value={form.bolBC} onChange={(value) => change("bolBC", value.replace(/\D/g, ""))} inputMode="numeric" />
          <Field label="Bales *" value={form.baleCount} onChange={(value) => change("baleCount", value.replace(/\D/g, ""))} inputMode="numeric" />
          <label style={labelStyle}>Equipment *
            <select required value={form.equipmentType} onChange={(event) => change("equipmentType", event.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="V">Van</option>
              <option value="F">Flatbed</option>
            </select>
          </label>
        </div>

        <label style={labelStyle}>Comment
          <textarea value={form.comment} onChange={(event) => change("comment", event.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </label>

        {error ? <div role="alert" style={errorBoxStyle}>{error}</div> : null}
        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? .65 : 1 }}>
          {submitting ? "Verifying location…" : "Verify location & check in"}
        </button>
        <p style={privacyStyle}>Your location is used to confirm this check-in at the yard and is saved with the arrival record.</p>
      </form>
    </main>
  );
}

function Field(props: {
  label: string; value: string; onChange: (value: string) => void;
  inputMode?: "text" | "tel" | "numeric"; autoComplete?: string; autoCapitalize?: string;
}) {
  return <label style={labelStyle}>{props.label}
    <input required={props.label.endsWith("*")} value={props.value}
      onChange={(event) => props.onChange(event.target.value)} style={inputStyle}
      inputMode={props.inputMode} autoComplete={props.autoComplete} autoCapitalize={props.autoCapitalize} />
  </label>;
}

const shellStyle: React.CSSProperties = { maxWidth: 620, margin: "0 auto", padding: "12px 0 40px" };
const cardStyle: React.CSSProperties = { padding: "clamp(20px, 5vw, 34px)", borderRadius: 24, border: "1px solid rgba(99,102,241,.35)", background: "rgba(15,23,42,.94)", boxShadow: "0 22px 60px rgba(0,0,0,.36)" };
const badgeStyle: React.CSSProperties = { display: "inline-block", padding: "5px 10px", borderRadius: 999, color: "#67e8f9", background: "rgba(34,211,238,.08)", border: "1px solid rgba(34,211,238,.2)", fontSize: 11, fontWeight: 900, letterSpacing: ".14em" };
const titleStyle: React.CSSProperties = { margin: "16px 0 8px", fontSize: "clamp(28px, 8vw, 40px)", lineHeight: 1.05, color: "#f8fafc" };
const bodyStyle: React.CSSProperties = { color: "#a8b5c8", lineHeight: 1.55, fontSize: 15 };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, margin: "24px 0 14px" };
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7, color: "#cbd5e1", fontSize: 13, fontWeight: 800 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 48, padding: "11px 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.3)", background: "#0b1220", color: "#f8fafc", fontSize: 16 };
const buttonStyle: React.CSSProperties = { width: "100%", marginTop: 20, padding: "15px 18px", border: 0, borderRadius: 12, color: "white", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", fontSize: 17, fontWeight: 900, cursor: "pointer" };
const errorStyle: React.CSSProperties = { color: "#fca5a5", lineHeight: 1.5 };
const errorBoxStyle: React.CSSProperties = { marginTop: 16, padding: 12, borderRadius: 10, color: "#fecaca", background: "rgba(127,29,29,.34)", border: "1px solid rgba(248,113,113,.3)", lineHeight: 1.4 };
const privacyStyle: React.CSSProperties = { margin: "12px 0 0", color: "#64748b", fontSize: 11, textAlign: "center", lineHeight: 1.4 };
