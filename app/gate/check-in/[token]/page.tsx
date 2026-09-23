"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Site = { terminal: "SAV" | "HOU"; siteCode: string; siteName: string };

type FormState = {
  checkinType: string;
  driverName: string;
  driverPhone: string;
  movementDirection: string;
  materialType: string;
  referenceNumber: string;
  destination: string;
  mark: string;
  bolBaleCount: string;
};

const EMPTY_FORM: FormState = {
  checkinType: "", driverName: "", driverPhone: "", movementDirection: "", materialType: "",
  referenceNumber: "", destination: "", mark: "", bolBaleCount: "",
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

async function prepareBolPhoto(file: File) {
  const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (accepted.has(file.type) && file.size <= 2.5 * 1024 * 1024) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo format could not be read. Set the camera to JPG/Most Compatible or take a screenshot of the paperwork.");
  }

  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This phone could not prepare the paperwork photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .78));
  if (!blob || blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("The paperwork photo is too large. Retake it at a lower resolution.");
  }
  return new File([blob], "bol-photo.jpg", { type: "image/jpeg" });
}

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
  const [bolPhoto, setBolPhoto] = useState<File | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueSiteName, setQueueSiteName] = useState("");
  const [queuedDriverName, setQueuedDriverName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [clientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let id = crypto.randomUUID();
    try {
      const stored = window.localStorage.getItem("scm-container-device-id");
      if (stored) id = stored;
      else window.localStorage.setItem("scm-container-device-id", id);
    } catch {
      // The in-memory ID still protects this browser tab if storage is unavailable.
    }
    setDeviceId(id);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    async function load() {
      try {
        const query = new URLSearchParams({ deviceId });
        const response = await fetch(`/api/gate/check-in/${token}?${query}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "This check-in link is unavailable");
        if (!cancelled) {
          setSite(result.site);
          if (result.activeQueue) {
            setQueuePosition(Number(result.activeQueue.position));
            setQueueSiteName(result.activeQueue.siteName);
            setQueuedDriverName(result.activeQueue.driverName);
            setComplete(true);
          }
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "This check-in link is unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token, deviceId]);

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
      const preparedPhoto = form.checkinType === "domestic" && bolPhoto ? await prepareBolPhoto(bolPhoto) : null;
      const request = new FormData();
      request.set("clientId", clientId);
      request.set("deviceId", deviceId);
      request.set("checkinType", form.checkinType);
      request.set("driverName", form.driverName);
      request.set("driverPhone", form.driverPhone);
      request.set("movementDirection", form.movementDirection);
      request.set("materialType", form.materialType);
      request.set("referenceNumber", form.referenceNumber);
      request.set("destination", form.destination);
      request.set("mark", form.mark);
      request.set("bolBaleCount", form.bolBaleCount);
      request.set("latitude", String(position.coords.latitude));
      request.set("longitude", String(position.coords.longitude));
      request.set("accuracyMeters", String(position.coords.accuracy));
      request.set("capturedAt", new Date(position.timestamp).toISOString());
      if (preparedPhoto) request.set("bolPhoto", preparedPhoto);
      const response = await fetch(`/api/gate/check-in/${token}`, {
        method: "POST",
        body: request,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Check-in failed");
      setQueuePosition(result.queue === true ? Number(result.position) : null);
      setQueueSiteName(result.siteName || site.siteName);
      setQueuedDriverName(result.driverName || form.driverName);
      setPhotoSaved(result.photoSaved === true);
      setPhotoFailed(Boolean(bolPhoto) && result.photoSaved !== true);
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
        <h1 style={titleStyle}>{queuePosition !== null ? "You’re in line" : "You’re checked in"}</h1>
        {queuePosition !== null ? <>
          <div style={{ color: "#67e8f9", fontSize: 80, lineHeight: 1, fontWeight: 950, margin: "24px 0 8px" }}>#{queuePosition}</div>
          <p style={bodyStyle}>{queuedDriverName ? `${queuedDriverName}, this is your` : "Your"} current place in the container line at {queueSiteName || site.siteName}.</p>
          <p style={{ ...bodyStyle, color: "#fbbf24" }}>This phone cannot check in another container driver until warehouse staff completes or removes this entry.</p>
        </> : <p style={bodyStyle}>Your arrival was sent to {site.siteName}. Warehouse staff can now see your load.</p>}
        {photoSaved ? <p style={{ ...bodyStyle, color: "#86efac" }}>Your paperwork photo was attached.</p> : null}
        {photoFailed ? <p style={{ ...bodyStyle, color: "#fbbf24" }}>Your check-in was saved, but the photo did not upload. Keep your paper BOL ready for warehouse staff.</p> : null}
        <p style={{ ...bodyStyle, color: "#67e8f9", fontWeight: 800 }}>Please follow the yard’s instructions and wait for direction.</p>
      </div>
    </main>
  );

  return (
    <main style={shellStyle}>
      <form onSubmit={submit} style={cardStyle}>
        <div style={badgeStyle}>SCM DRIVER CHECK-IN</div>
        <h1 style={titleStyle}>{site.siteName}</h1>
        <p style={bodyStyle}>Choose why you are here. When you submit, your phone will verify that you are at the yard.</p>

        <div style={choiceGridStyle}>
          <Choice selected={form.checkinType === "container"} title="Container / Drayage" detail="Join the driver line" onClick={() => change("checkinType", "container")} />
          <Choice selected={form.checkinType === "domestic"} title="Domestic Freight" detail="Pickup or delivery" onClick={() => change("checkinType", "domestic")} />
        </div>

        {form.checkinType ? <div style={gridStyle}>
          <Field label="Driver name *" value={form.driverName} onChange={(value) => change("driverName", value)} autoComplete="name" />
          {form.checkinType === "domestic" ? <>
          <Field label="Mobile number *" value={form.driverPhone} onChange={(value) => change("driverPhone", value)} autoComplete="tel" inputMode="tel" />
          <label style={labelStyle}>Pickup or delivery? *
            <select required value={form.movementDirection} onChange={(event) => change("movementDirection", event.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
            </select>
          </label>
          <label style={labelStyle}>Material *
            <select required value={form.materialType} onChange={(event) => change("materialType", event.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="cotton">Cotton</option>
              <option value="lumber">Lumber</option>
              <option value="other">Other / FAK</option>
            </select>
          </label>
          <Field label="Reference number *" value={form.referenceNumber} onChange={(value) => change("referenceNumber", value.toUpperCase())} autoCapitalize="characters" />
          {form.movementDirection === "pickup" ? (
            <Field label="Destination *" value={form.destination} onChange={(value) => change("destination", value.toUpperCase())} />
          ) : null}
          {form.materialType === "cotton" ? <>
            <Field label="Mark *" value={form.mark} onChange={(value) => change("mark", value.toUpperCase())} autoCapitalize="characters" />
            <Field label="Bale count on BOL *" value={form.bolBaleCount} onChange={(value) => change("bolBaleCount", value.replace(/\D/g, ""))} inputMode="numeric" />
          </> : null}
          </> : null}
        </div> : null}

        {form.checkinType === "container" ? <div style={noticeStyle}>Check in only yourself. Each phone may hold one active place in the container line.</div> : null}

        {form.checkinType === "domestic" ? <label style={labelStyle}>Paperwork photo (optional)
          <input type="file" accept="image/*" capture="environment"
            onChange={(event) => setBolPhoto(event.target.files?.[0] ?? null)}
            style={fileInputStyle} />
          <small style={{ color: "#64748b", fontWeight: 500 }}>
            {bolPhoto ? bolPhoto.name : "Take a clear photo of the BOL, pickup order, or other paperwork."}
          </small>
        </label> : null}

        {error ? <div role="alert" style={errorBoxStyle}>{error}</div> : null}
        {form.checkinType ? <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? .65 : 1 }}>
          {submitting ? "Verifying location…" : form.checkinType === "container" ? "Verify location & join line" : "Verify location & check in"}
        </button> : null}
        <p style={privacyStyle}>Your location is used to confirm this check-in at the yard and is saved with the arrival record.</p>
      </form>
    </main>
  );
}

function Choice({ selected, title, detail, onClick }: { selected: boolean; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ ...choiceStyle, borderColor: selected ? "#67e8f9" : "rgba(148,163,184,.3)", background: selected ? "rgba(8,145,178,.18)" : "#0b1220" }}>
    <strong style={{ fontSize: 17, color: "#f8fafc" }}>{title}</strong>
    <span style={{ color: "#94a3b8", fontSize: 13 }}>{detail}</span>
  </button>;
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
const choiceGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 24 };
const choiceStyle: React.CSSProperties = { minHeight: 100, padding: 14, borderRadius: 12, border: "1px solid", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, textAlign: "left", cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7, color: "#cbd5e1", fontSize: 13, fontWeight: 800 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 48, padding: "11px 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.3)", background: "#0b1220", color: "#f8fafc", fontSize: 16 };
const fileInputStyle: React.CSSProperties = { ...inputStyle, padding: "10px", height: "auto" };
const buttonStyle: React.CSSProperties = { width: "100%", marginTop: 20, padding: "15px 18px", border: 0, borderRadius: 12, color: "white", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", fontSize: 17, fontWeight: 900, cursor: "pointer" };
const errorStyle: React.CSSProperties = { color: "#fca5a5", lineHeight: 1.5 };
const errorBoxStyle: React.CSSProperties = { marginTop: 16, padding: 12, borderRadius: 10, color: "#fecaca", background: "rgba(127,29,29,.34)", border: "1px solid rgba(248,113,113,.3)", lineHeight: 1.4 };
const noticeStyle: React.CSSProperties = { marginTop: 12, padding: 12, borderRadius: 10, color: "#fde68a", background: "rgba(120,53,15,.25)", border: "1px solid rgba(251,191,36,.25)", fontSize: 13, lineHeight: 1.45 };
const privacyStyle: React.CSSProperties = { margin: "12px 0 0", color: "#64748b", fontSize: 11, textAlign: "center", lineHeight: 1.4 };
