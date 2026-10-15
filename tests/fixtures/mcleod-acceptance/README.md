# Acceptance fixture v2: review before deployment

Canary: scm-pr1-acceptance-v2-20261014. Existing fixtures are preserved.

## New reference matrix
- OUTSIDE-NONE-1014: exact ID and both reference searches return HTTP200 empty arrays. Complete no-match, eligible for outside workflow only subject to the app's other checks.
- SCM-FRESH-1014: fresh MAIN cotton88bale delivery to HOU5300. Unique SO stop SCM-FRESH-1014-SO; linked PU stop SCM-FRESH-1014-PU at Synthetic Remote Warehouse. Synthetic Fresh Acceptance Carrier, Synthetic SCM-FRESH-1014 driver. Remote pickup has explicit arrival06:00 and departure07:00(-0500) on October14; delivery actuals are missing. Only the SO stop accepts simulated clearStop; PU overwrite is rejected.
- WRONG-YARD-1014: matching reference at HOU4331, fails HOU5300 pickup/delivery with YARD_STOP_NOT_FOUND.
- NONMAIN-1014: matching but non-MAIN revenue, fails NOT_MAIN_ORDER.
- PARTIAL-1014: valid search result but missing order-detail stops, fails DEPENDENCY_UNAVAILABLE.
- DENSE-CAP-2951: 100 false-hit rows across20pages; both directions fail INCOMPLETE_LOOKUP. Never grants automatic outside handling.

Existing 2951 is a27-row synthetic pagination success, NOT a reproduction/fix of historical real2951's100raw/20page cap. The real limitation remains. A longer4500281026 or full2951 / 4500281026 can be more selective; no live vendor request has been performed. Existing left-hyphen500 issue is not fixed by these fixtures.

## Isolation
No environment reads, fetch clients, DB access, live McLeod requests, production calls or real credentials. Uses public synthetic selector Authorization: Bearer scm-local-synthetic-only. Hosted handler has fresh state each invocation; control/report mutations reject409. Simulated clearStop logs and returns OK without persisting vendor actuals. Negative-case stop writes reject422. Existing seeded SCM-NORMAL is unchanged.

QR test browser geolocation and isolated DB location configuration are separate runtime-worker tasks; fixture does not spoof either. Use HOU5300 for intended-site validation. A synthetic0,0 test geofence requires separately verified isolated configuration and supported browser geolocation control.

## Verification
62 integration checks against read-only exact SCM5dc2bc9 buildPreview/driver/reference resolvers;41 hosted adapter assertions pass. All integration fetches confined to loopback. No appsource edits. Hosted deployment not performed.

## Manual deployment only after review
Extract ZIP into a NEW empty folder, not the SCM app checkout. Contents are directly at ZIP root. Keep .vercel/project.json. Run node verify-fixture.mjs to verify source hashes and target. From this same isolated folder, the user may then run:
vercel deploy --yes --target=preview --scope scmdevelopment912-9984s-projects
No CLI installation/update, pipe, helper subprocess, --prod or production promotion.
The pinned project already exists: prj_UYfNDy13QgWDxpkOPqZrXwDMC0hQ; team team_QsMSXZFWEo6KwXOmhjuxVc90.
This command requests preview; effective deployment target must be inspected afterward. Vercel assigns first deployments to production even when preview is requested. Do not infer target from local text or retry after a CLI crash until existing deployments are checked. Do not use the original deployment helper.
No protection change is included. Preserve the user-approved fixture-only public setting, never modify SCM application/team protection. Return the unique deployment URL and verify the new canary before pointing staging at it.
