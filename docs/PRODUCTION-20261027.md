# Production execution record — October 27, 2026

Application release: e69cc1ba7f632f0820b2a9c6a130673044313882.
Production deployment: dpl_DZNeccoD8RXCJdxcTKEBKTht1Cm3 (CLI, production target, READY).
Unique URL: https://scm-platform-ptn3ygrbi-scmdevelopment912-9984s-projects.vercel.app

User explicitly approved production execution. PR #4 has not been merged.

## Backup evidence

User-created backup scm-before-e69cc1b-20261027-003113.dump: 1.7 MB; pg_restore --list passed; SHA256 cb9b56795dd480c2d969d11246c94d48035f07bd75456dfb597f1fbc411c6a27.
Isolated local PostgreSQL 17 application restore passed: 1032 check-ins, 221 inventory lots/events, 13 outside-carrier events, 17 already-completed reconciliation events, 12 Auth users and 38 Storage metadata rows.
Two NOT VALID check constraints matched the source production schema; production has zero violations.
Restore excluded provider Vault/Realtime/GraphQL infrastructure, ownership/ACL restoration and actual Storage objects. This is application-data recoverability evidence, not a complete Supabase platform recovery test.

Refreshed immediately before rollout: scm-before-e69cc1b-20261027-080309.dump, 1.7 MB; archive list succeeded; SHA256 736bb82ce096673d1da6f9d2d77f4db4928844a859598ea6162666c0b4fe94fc.
The refreshed archive itself was not separately restore-tested. Backups remain privately on the user's computer.

## Execution

Vercel API production-build attempt dpl_8xVLNxgxhQWvq3wTnXhSsckWquPq was canceled before completion because it scheduled an alias. Existing production aliases were verified still on the October 16 deployment. The user then built the exact detached commit using vercel deploy --prod --skip-domain; the verified staged deployment above had no aliases.

Production was briefly paused for migrations, then unpaused after migration verification. Production database: iurnpebmdfbjttejlymr.
Applied only:
- physical_departure (049), migration history 20261027120605
- local_receiving_only (050), 20261027120606
- physical_departure_audit_permissions, 20261027120607
- local_receiving_inventory, 20261027120758

048 was not replayed. Local-only backfill candidates: zero.
Verified new columns, RLS, departure and inventory triggers. service_role can SELECT/INSERT departure events, cannot UPDATE/DELETE/TRUNCATE; anon/authenticated inspected privileges denied.
Existing completed-reconciliation function MD5 remains b11d923bce047820242c2ac6e4e57718, executable only by postgres/service_role.

Deployed receiving row routes and Active Line source content identities matched the approved source after CRLF normalization. Staged browser served staff sign-in; unauthenticated check-in API returned 401.
Promoted the already-built production deployment without rebuilding.
Both scm-platform-pnl.vercel.app and scm-platform-pnl-scmdevelopment912-9984s-projects.vercel.app resolve to dpl_DZNeccoD8RXCJdxcTKEBKTht1Cm3.

Post-promotion counts: 1035 check-ins, 221 inventory lots, 221 inventory events, zero physical-departure events, zero processing rows, zero write_pending rows. No receiving records or McLeod actuals were changed by these migrations. Live browser serves staff sign-in, not the maintenance page.

## Remaining operational acceptance

Authenticated production receiving and a real McLeod delivery smoke test remain pending; no successful live vendor write or real-phone GPS test is claimed. Staging synthetic acceptance is documented separately.
Do not automatically retry any uncertain vendor write. Audit and uncertainty evidence must survive rollback.

## Rollback

Previous deployment: dpl_4VWmhqtw4bPfWBaQM1T3ToSVwB5v.
URL: https://scm-platform-jwqdan0n4-scmdevelopment912-9984s-projects.vercel.app
Pause warehouse writes, record in-flight/uncertain operations, roll back the application and verify both aliases and schema compatibility. Retain additive columns/audits; never restore a stale full database backup over new operations or blindly retry McLeod writes.
