"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";

type GateSite = {
  id: string;
  terminal: "SAV" | "HOU";
  site_code: string;
  site_name: string;
  public_token: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  active: boolean;
  updated_at: string;
};

export default function GateCheckinSetupPage() {
  const [sites, setSites] = useState<GateSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/warehouse/gate-sites", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not load gate sites");
      setSites(result.sites ?? []);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not load gate sites");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function replaceSite(site: GateSite) {
    setSites((current) => current.map((item) => item.id === site.id ? site : item));
  }

  return (
    <main style={{ maxWidth: 1300, margin: "0 auto" }}>
      <PlatformPageHeader
        title="Driver QR Check-In"
        subtitle="Set the exact gate position and allowed radius, then print the QR sign for that yard. A link remains unavailable until it is active."
        actions={<Link href="/warehouse/inventory" style={secondaryButtonStyle}>← Warehouse Inventory</Link>}
      />
      {message ? <div style={errorStyle}>{message}</div> : null}
      {loading ? <PlatformPanel>Loading gate sites…</PlatformPanel> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 480px), 1fr))", gap: 18 }}>
          {sites.map((site) => <GateCard key={site.id} site={site} onSaved={replaceSite} />)}
        </div>
      )}
    </main>
  );
}

function GateCard({ site, onSaved }: { site: GateSite; onSaved: (site: GateSite) => void }) {
  const [latitude, setLatitude] = useState(site.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(site.longitude?.toString() ?? "");
  const [radius, setRadius] = useState(site.radius_m.toString());
  const [active, setActive] = useState(site.active);
  const [qr, setQr] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const gateUrl = origin ? `${origin}/gate/check-in/${site.public_token}` : "";

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    let cancelled = false;
    if (!gateUrl) return;
    void QRCode.toDataURL(gateUrl, { width: 320, margin: 2, color: { dark: "#020617", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setQr(url); });
    return () => { cancelled = true; };
  }, [gateUrl]);

  function useCurrentLocation() {
    setStatus("Getting this device’s location…");
    navigator.geolocation.getCurrentPosition((position) => {
      setLatitude(position.coords.latitude.toFixed(7));
      setLongitude(position.coords.longitude.toFixed(7));
      setStatus(`Gate pin captured (accuracy ±${Math.round(position.coords.accuracy)} m). Save to apply it.`);
    }, () => setStatus("Could not get this device’s location."), {
      enableHighAccuracy: true, timeout: 20_000, maximumAge: 0,
    });
  }

  async function save(rotateToken = false) {
    if (rotateToken && !window.confirm("Replace this QR link? Any already-printed QR signs for this yard will stop working.")) return;
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/warehouse/gate-sites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminal: site.terminal, siteCode: site.site_code,
          latitude: Number(latitude), longitude: Number(longitude),
          radiusM: Number(radius), active, rotateToken,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save gate site");
      onSaved(result.site);
      setStatus(rotateToken ? "A new QR link was created." : "Gate settings saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Could not save gate site");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(gateUrl);
    setStatus("Driver link copied.");
  }

  function printQr() {
    if (!qr) return;
    const popup = window.open("", "_blank", "width=640,height=760");
    if (!popup) {
      setStatus("Allow pop-ups for this page, then try printing again.");
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>${site.site_name} Driver Check-In</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#0f172a}h1{font-size:34px;margin:12px 0}p{font-size:20px}img{width:420px;max-width:90vw}small{display:block;margin-top:24px;font-size:11px;word-break:break-all}@media print{body{padding:10px}}</style>
      </head><body><div>SCM DRIVER CHECK-IN</div><h1>${site.site_name}</h1><p>Scan to check in when you arrive</p><img src="${qr}" alt="Driver check-in QR"><small>${gateUrl}</small>
      <script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  }

  return (
    <PlatformPanel style={{ margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#f8fafc", fontSize: 23, fontWeight: 900 }}>{site.site_name}</div>
          <div style={{ color: site.active ? "#86efac" : "#fbbf24", marginTop: 5, fontSize: 12, fontWeight: 800 }}>
            {site.active ? "ACTIVE" : "NOT ACTIVE"}
          </div>
        </div>
        {qr ? <img src={qr} alt={`QR code for ${site.site_name}`} style={{ width: 126, height: 126, background: "white", padding: 5, borderRadius: 8 }} /> : null}
      </div>

      <div style={fieldGridStyle}>
        <GateField label="Gate latitude" value={latitude} onChange={setLatitude} />
        <GateField label="Gate longitude" value={longitude} onChange={setLongitude} />
        <GateField label="Allowed radius (meters)" value={radius} onChange={(value) => setRadius(value.replace(/\D/g, ""))} />
      </div>

      <label style={{ display: "flex", gap: 9, alignItems: "center", color: "#e2e8f0", fontWeight: 800, marginTop: 16 }}>
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Accept driver check-ins from this QR
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 18 }}>
        <Link href={`/warehouse/gate/${site.terminal.toLowerCase()}/${site.site_code}/containers`} style={primaryButtonStyle}>View container line</Link>
        <Link href={`/warehouse/gate/${site.terminal.toLowerCase()}/${site.site_code}/domestic`} style={primaryButtonStyle}>Lumber & Other check-in</Link>
        <button type="button" onClick={useCurrentLocation} style={secondaryButtonStyle}>Use my current location</button>
        <button type="button" onClick={() => void save()} disabled={saving} style={primaryButtonStyle}>{saving ? "Saving…" : "Save settings"}</button>
        <button type="button" onClick={() => void copyLink()} disabled={!gateUrl} style={secondaryButtonStyle}>Copy driver link</button>
        <button type="button" onClick={printQr} disabled={!qr} style={secondaryButtonStyle}>Print QR</button>
        <button type="button" onClick={() => void save(true)} disabled={saving} style={dangerButtonStyle}>Replace QR link</button>
      </div>
      <div style={{ color: "#64748b", fontSize: 11, wordBreak: "break-all", marginTop: 14 }}>{gateUrl}</div>
      {status ? <div style={{ color: "#a5b4fc", fontSize: 13, marginTop: 10 }}>{status}</div> : null}
    </PlatformPanel>
  );
}

function GateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "#94a3b8", fontSize: 12, fontWeight: 800 }}>
    {label}
    <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="decimal" style={inputStyle} />
  </label>;
}

const fieldGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 18 };
const inputStyle: React.CSSProperties = { minHeight: 42, borderRadius: 9, border: "1px solid rgba(148,163,184,.28)", background: "#0b1220", color: "#f8fafc", padding: "8px 10px", fontSize: 15 };
const secondaryButtonStyle: React.CSSProperties = { padding: "10px 13px", borderRadius: 9, border: "1px solid rgba(148,163,184,.26)", background: "rgba(15,23,42,.9)", color: "#e2e8f0", fontWeight: 800, cursor: "pointer" };
const primaryButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, border: "1px solid rgba(99,102,241,.55)", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white" };
const dangerButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, border: "1px solid rgba(248,113,113,.35)", color: "#fca5a5" };
const errorStyle: React.CSSProperties = { padding: 12, borderRadius: 10, color: "#fecaca", background: "rgba(127,29,29,.34)", marginBottom: 16 };
