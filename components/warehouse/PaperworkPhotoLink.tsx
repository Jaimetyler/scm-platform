type Props = { checkinId: string; compact?: boolean };

export default function PaperworkPhotoLink({ checkinId, compact = false }: Props) {
  return <a href={`/api/warehouse/checkin-bol/${checkinId}`} target="_blank" rel="noreferrer"
    aria-label="Open uploaded paperwork photo" title="Open uploaded paperwork photo"
    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: compact ? "2px 5px" : "3px 7px",
      borderRadius: 6, border: "1px solid rgba(103,232,249,.4)", background: "rgba(34,211,238,.12)",
      color: "#67e8f9", fontWeight: 800, fontSize: compact ? 10 : 11, textDecoration: "none", whiteSpace: "nowrap" }}>
    <span aria-hidden="true">📷</span> Photo
  </a>;
}
