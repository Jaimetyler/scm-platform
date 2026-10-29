# Pickup agreements

Source: Jaime's SCM “PICK UP ONLY” paper form uploaded 2026-10-27. English copy preserves its four operational terms: 8-foot drop tarps for lumber and $400 handling/rehandling charge, carrier scale/legal weight responsibility, driver-directed loading and safe transport responsibility, and wheel chocks/truck shutdown. Obvious spelling/duplicate-word errors were cleaned up; the Spanish version translates the same requirements. Electronic-signing consent is a separate new acknowledgment. No automatic fee billing is implemented.

## Behavior

Domestic QR pickups (cotton, lumber, other) must provide the paper form's trailer, product, pickup number, reference/PO and printed name, draw a signature, acknowledge the terms and consent to electronic signing. Carrier, phone, destination, yard and arrival data come from the check-in. The printed name must match the driver name. Language or load-detail changes require renewed acknowledgment; the drawing remains available. Deliveries and container/drayage line registration are unchanged because the latter does not identify a pickup. Staff-created and historical records are not fabricated as signed; continue paper collection for those.

The server selects the versioned canonical terms and snapshots them with the signature, language, identity and load context. It ignores any browser-supplied terms/time. The database stamps acceptance time. Signature and arrival are inserted atomically. Failed signature validation saves neither. Reusing a check-in UUID cannot replace an earlier agreement. Ordinary staff edits can correct the operating record while the signed snapshot stays unchanged. No McLeod actuals or fee charges are written by agreement capture.

Signed snapshots are excluded from normal grid serializers. Authorized staff see the saved terms, details and drawing on Driver Check-In Details; operator terminal scope is checked before rendering. The underlying table remains RLS-enabled and service-only. No signatures are public URLs or localStorage values.

## Validation and release

Local tests exercise unsigned/stale/mismatched consent rejection, valid submission, bounded coordinates, language/load invalidation, server canonical terms, atomic DB persistence, duplicate identity, database timestamp, update/delete prevention, ongoing row edits, and denied anon/authenticated database reads. Initial candidate 95cc623 passed 380 tests, TypeScript, GitHub Actions run 127 and exact-commit preview build. Staging browser verified English/Spanish agreement display and retained trailer details; no GPS permission or live submission was performed. Staging SQL verified database time, immutable signature snapshots and ordinary operational edits, rolling back the synthetic fixture. RLS/service-only privileges and the trigger search_path were verified. The signature component pointer-handler test and final presentation refinements require the final exact-commit CI/build check. Existing staging security advisor warnings are unchanged (older mutable-search-path functions and leaked-password protection disabled); the new trigger function has a fixed search_path and is invoker security.

Production currently runs 31467bb, approved and deployed 2026-10-27 as dpl_Ff9tn7cQzWYS7qDzggYdHJppgNLv. Both production aliases were verified; login 200 and unauthenticated staff API 401 on both; scoped error/fatal logs returned none in the initial verification window. Agreement feature is not in that release.

Deployment order for agreements, after exact candidate approval:
1. Refresh and verify the production logical backup privately, retaining the existing restore-tested baseline.
2. Confirm no in-flight or uncertain McLeod writes. Apply 20261027133220_pickup_agreements.sql once and verify column, trigger, RLS and permissions; do not replay migrations 048–050.
3. Deploy the approved exact Git SHA to the existing SCM Vercel project with production environment. Verify READY and source SHA, then verify both production aliases point to it.
4. Confirm public QR loads, unsigned pickup is blocked, staff pages require sign-in and a real authorized pickup records its signature once. Never submit a real agreement on a driver's behalf. Check runtime errors and receiving protections.
5. Rollback: point both application aliases to 31467bb deployment dpl_Ff9tn7cQzWYS7qDzggYdHJppgNLv. Retain the additive column and immutable signed records. Resume paper agreements for new pickups. Never restore an older database over new operational records or clear uncertain-write fences.

Limitations: field tests on a real driver's phone/GPS and an actual driver's signature remain operational acceptance. Spanish content and electronic-signing wording are visible for Jaime's review before production approval. This feature does not collect signatures for staff-only arrivals or the container line, and does not automatically gate staff loading/checkout on agreement presence. Signed-record delete prevention intentionally requires retention; privileged administrators remain capable of changing the database schema.
