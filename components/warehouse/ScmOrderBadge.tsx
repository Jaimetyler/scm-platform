export default function ScmOrderBadge({ orderId }: { orderId: string | null | undefined }) {
  if (!orderId) return null;
  return <span title={`SCM order #${orderId}`} aria-label={`SCM order #${orderId}`} style={{
    display: "inline-block", padding: "1px 4px", borderRadius: 4,
    background: "rgba(8,145,178,.18)", border: "1px solid rgba(34,211,238,.45)",
    color: "#67e8f9", fontSize: 9, fontWeight: 900, letterSpacing: ".04em", lineHeight: "13px",
  }}>SCM</span>;
}
