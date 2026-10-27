"use client";
import { useRef } from "react";
import { PICKUP_TERMS, type PickupAcceptance, type SignatureStroke } from "@/lib/inbound/checkin/pickup-agreement";
export default function PickupAgreement({ value, onChange, language }: { value: PickupAcceptance; onChange: (value: PickupAcceptance) => void; language: "en" | "es" }) {
  const drawing = useRef(false);
  const current = useRef<SignatureStroke>([]);
  const latest = useRef(value); latest.current = value;
  const terms = PICKUP_TERMS[language];
  const label = (en: string, es: string) => language === "es" ? es : en;
  const update = (patch: Partial<PickupAcceptance>) => onChange({ ...latest.current, ...patch, language, acknowledged: false, electronicConsent: false });
  return <section aria-label={terms.title} style={{ marginTop: 24, color: "#e2e8f0", border: "1px solid #64748b", padding: 16, borderRadius: 12 }}>
    <h2>{terms.title}</h2><p>{terms.introduction}</p>
    <ol style={{ paddingLeft: 22, lineHeight: 1.6 }}>{terms.clauses.map(text => <li key={text} style={{ marginBottom: 14 }}>{text}</li>)}</ol>
    {([['trailerNumber','Trailer number','Número de remolque'],['productDescription','Description of product','Descripción del producto'],['pickupNumber','Pickup number','Número de recolección'],['referencePo','Reference / PO number','Referencia / número de orden de compra'],['printedName','Driver printed name','Nombre del conductor en letra de molde']] as const).map(([key,en,es]) => <label key={key} style={{ display: "block", marginTop: 12 }}>{label(en,es)} *<input required maxLength={200} value={value[key]} onChange={event => update({ [key]: event.target.value })} style={{ display: "block", width: "100%", padding: 10, color: "#111827", background: "white" }} /></label>)}
    <p>{label("Draw your signature below. If you cannot sign here, ask warehouse staff for the paper form.","Dibuje su firma abajo. Si no puede firmar aquí, pida al personal el formulario en papel.")}</p>
    <svg role="img" aria-label={label("Driver signature", "Firma del conductor")} viewBox="0 0 600 180" preserveAspectRatio="none" style={{ width: "100%", height: 180, background: "white", touchAction: "none", border: "2px solid #64748b" }}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; const r = event.currentTarget.getBoundingClientRect(); current.current = [[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]]; update({ strokes: [...latest.current.strokes, current.current] }); }}
      onPointerMove={event => { if (!drawing.current || latest.current.strokes.flat().length >= 4000) return; const r = event.currentTarget.getBoundingClientRect(); current.current = [...current.current,[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]]; update({ strokes: [...latest.current.strokes.slice(0,-1),current.current] }); }}
      onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}>
      {value.strokes.map((stroke,i) => <polyline key={i} points={stroke.map(([x,y])=>`${x*600},${y*180}`).join(" ")} fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    <button type="button" onClick={() => update({ strokes: [] })} style={{ padding: 10, margin: "8px 0" }}>{label("Clear signature","Borrar firma")}</button>
    <label style={{ display: "flex", gap: 10, marginTop: 14 }}><input required type="checkbox" checked={value.acknowledged} onChange={event => onChange({ ...value, language, acknowledged: event.target.checked })} />{terms.acknowledgment}</label>
    <label style={{ display: "flex", gap: 10, marginTop: 14 }}><input required type="checkbox" checked={value.electronicConsent} onChange={event => onChange({ ...value, language, electronicConsent: event.target.checked })} />{terms.consent}</label>
  </section>;
}
