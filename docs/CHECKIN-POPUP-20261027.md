# Streamlined check-in and diagnostics

User requested no duplicate agreement fields, a general trailer number, a popup agreement with a usable mobile signature surface, and removal of logs from the Active Line.

The domestic driver form collects trailer number once (required for pickups; optional for deliveries). The agreement popup contains only unchanged versioned terms, drawing, and two acknowledgments. Name, material, order/reference and trailer are derived on the server from the submitted check-in and freshly resolved order data. Client-supplied repeated agreement fields are discarded. Older open tabs can still supply trailer number in the prior agreement location. Existing signed snapshots remain unchanged.

The popup uses native modal dialog focus management, locks background scrolling while open, and restores it on close/unmount. The signature wrapper and SVG disable touch panning, capture pointer input and prevent native touch scrolling only within the pad. Terms can scroll in the popup. Local tests cover non-passive touch handlers, pointer drawing, clear, invalid consent, escape and overflow restoration. Actual iPhone behavior still needs a device check; browser automation is not a physical touch-device certification.

Departed/reconciliation and completed/unresolved panels moved off Active Line to `/warehouse/gate/[terminal]/[siteCode]/diagnostics`. Both sections default collapsed. History has a collapsed Diagnostics entry linking there. Existing checkout safeguards and actionable row errors remain in the active table. The diagnostics server page authenticates staff and enforces operator terminal scope before private reads, filters the yard, and reads at most 200 recent matching records. It has no write/retry controls.

Schema: additive migration `20261027141025_checkin_trailer_number.sql`, nullable inbound `trailer_number` with maximum length 80. Staging only until approved. Apply migration before deploying this candidate. Rollback app to bf10dfd / dpl_DpUzV6ZT2wBkJ94kRbVkXcFTd47k; retain trailer column, agreement snapshots and audit data. Never replay agreement migration or restore stale database rows.
