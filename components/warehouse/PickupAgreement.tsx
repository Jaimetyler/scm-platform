"use client";
import { useEffect, useRef, useState } from "react";
import { PICKUP_TERMS, validatePickupAcceptance, type PickupAcceptance, type SignatureStroke } from "@/lib/inbound/checkin/pickup-agreement";

export default function PickupAgreement({ value, onChange, language }: { value: PickupAcceptance; onChange: (value: PickupAcceptance) => void; language: "en" | "es" }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const current = useRef<SignatureStroke>([]);
  const latest = useRef(value); latest.current = value;
  const terms = PICKUP_TERMS[language];
  const label = (en: string, es: string) => language === "es" ? es : en;
  const update = (patch: Partial<PickupAcceptance>) => { setError(""); onChange({ ...latest.current, ...patch, language, acknowledged: false, electronicConsent: false }); };
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { drawing.current = false; document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = rootOverflow; dialog.current?.close(); };
  }, [open]);
  useEffect(() => {
    // Safari can start page scrolling on an SVG even with pointer capture.
    // A non-passive native listener on the pad blocks that gesture only here.
    const target = pad.current;
    const preventScroll = (event: TouchEvent) => event.preventDefault();
    target?.addEventListener("touchstart", preventScroll, { passive: false });
    target?.addEventListener("touchmove", preventScroll, { passive: false });
    return () => { target?.removeEventListener("touchstart", preventScroll); target?.removeEventListener("touchmove", preventScroll); };
  }, []);
  const signed = value.acknowledged && value.electronicConsent && value.strokes.some(stroke => stroke.length >= 3);
  return <section style={{ marginTop: 20, color: "#e2e8f0" }}>
    <button type="button" onClick={() => { setError(""); setOpen(true); }} style={buttonStyle}>
      {signed ? label("Review signed pickup agreement", "Revisar el acuerdo de recolección firmado") : label("Review & sign pickup agreement", "Leer y firmar el acuerdo de recolección")}
    </button>
    <p role="status">{signed ? label("Signature and acknowledgments ready. They will be saved with your check-in.", "La firma y las confirmaciones están listas. Se guardarán con su registro.") : label("Your check-in details will be used. No need to enter them again.", "Se usarán los datos de su registro. No necesita ingresarlos de nuevo.")}</p>
    <dialog ref={dialog} aria-label={terms.title} onCancel={event => { event.preventDefault(); setOpen(false); }} style={{ width: "min(94vw, 660px)", maxHeight: "90dvh", margin: "auto", padding: 20, color: "#e2e8f0", background: "#0f172a", border: "1px solid #64748b", borderRadius: 16, overflowY: "auto", overscrollBehavior: "contain" }}>
      <button type="button" onClick={() => setOpen(false)} style={{ ...buttonStyle, float: "right", marginBottom: 12 }}>{label("Close", "Cerrar")}</button>
      <h2 style={{ clear: "both", fontSize: 22, fontWeight: 800, marginBottom: 12 }}>{terms.title}</h2>
      <p>{terms.introduction}</p>
      <ol style={{ paddingLeft: 22, lineHeight: 1.6, listStyleType: "decimal" }}>{terms.clauses.map(text => <li key={text} style={{ marginBottom: 14 }}>{text}</li>)}</ol>
      <p>{label("Draw your signature below. If you cannot sign here, ask warehouse staff for the paper form.", "Dibuje su firma abajo. Si no puede firmar aquí, pida al personal el formulario en papel.")}</p>
      <div ref={pad} style={{ touchAction: "none", overscrollBehavior: "none", userSelect: "none", WebkitUserSelect: "none", background: "white", border: "2px solid #64748b", borderRadius: 8, marginTop: 12 }}>
        <svg role="img" aria-label={label("Driver signature", "Firma del conductor")} viewBox="0 0 600 220" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 220, touchAction: "none", userSelect: "none" }}
          onPointerDown={event => { if (latest.current.strokes.length >= 100) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; const r = event.currentTarget.getBoundingClientRect(); current.current = [[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]]; update({ strokes: [...latest.current.strokes, current.current] }); }}
          onPointerMove={event => { if (!drawing.current || latest.current.strokes.flat().length >= 4000) return; event.preventDefault(); const r = event.currentTarget.getBoundingClientRect(); current.current = [...current.current,[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]]; update({ strokes: [...latest.current.strokes.slice(0,-1),current.current] }); }}
          onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} onLostPointerCapture={() => { drawing.current = false; }}>
          {value.strokes.map((stroke,i) => <polyline key={i} points={stroke.map(([x,y])=>`${x*600},${y*220}`).join(" ")} fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
      </div>
      <button type="button" onClick={() => update({ strokes: [] })} style={{ ...buttonStyle, margin: "12px 0" }}>{label("Clear signature", "Borrar firma")}</button>
      <label style={checkStyle}><input type="checkbox" checked={value.acknowledged} onChange={event => onChange({ ...value, language, acknowledged: event.target.checked })} />{terms.acknowledgment}</label>
      <label style={checkStyle}><input type="checkbox" checked={value.electronicConsent} onChange={event => onChange({ ...value, language, electronicConsent: event.target.checked })} />{terms.consent}</label>
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      <button type="button" style={{ ...buttonStyle, width: "100%", marginTop: 20, background: "#4f46e5" }} onClick={() => {
        try { validatePickupAcceptance(latest.current); setError(""); setOpen(false); }
        catch { setError(label("Draw your signature and check both acknowledgments before continuing.", "Dibuje su firma y marque ambas confirmaciones antes de continuar.")); }
      }}>{label("Use signature & return to check-in", "Usar la firma y volver al registro")}</button>
    </dialog>
  </section>;
}
const buttonStyle: React.CSSProperties = { minHeight: 44, padding: "10px 14px", border: "1px solid #64748b", borderRadius: 8, color: "white", background: "#1e293b", fontWeight: 700 };
const checkStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, lineHeight: 1.5 };
