"use client";
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
export default function CutoffInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [date, time = ""] = value.split("T");
  return <div><span>{label}</span><div style={{ display: "flex", gap: 6 }}>
    <input aria-label={`${label} date`} type="date" style={input} value={date} onChange={(event) => onChange(event.target.value ? `${event.target.value}${time ? `T${time}` : ""}` : "")} />
    <input aria-label={`${label} time (optional)`} type="time" disabled={!date} style={{ ...input, maxWidth: 135 }} value={time}
      onChange={(event) => onChange(`${date}${event.target.value ? `T${event.target.value}` : ""}`)} />
  </div></div>;
}
