# Focused outage and lumber/other lookup fix

Scope: reduce avoidable request pressure and fix multi-stop yard/direction matching. This is a review patch against main `4e782d464df79ff7cbe64b4e8b8bd33e722769af`, not a deployment. The broader audit packet remains separate and deferred. No outbound booking/import/split redesign or container limit is included.

## Changes

- Next is now pinned to **15.5.27**, including its matching environment and SWC packages. This is a targeted security update; the audits still contain unresolved dependency findings. See `SECURITY-UPDATE.md` in this packet.

- Visible, single-flight operational polling with deadlines, backoff and retry status; display-only carrier enrichment is bounded and deduplicated.
- Authentication/provider outages remain retryable failures, rather than being presented as wrong credentials or lost access. Every server request still verifies staff access.
- QR check-in has one “Pickup / delivery reference or SCM order number” field. Both lookup paths run, duplicate results are combined, and distinct matches require confirmation by trucking company and driver details. Indistinguishable matches require office review; customer information is not used to choose a load. The original input is retained separately from the canonical reference.
- Lumber/other lookup selects the exact yard and requested pickup/delivery direction across movements. The selected stop is saved and rechecked at checkout. Repeated same-direction visits never choose the first stop arbitrarily.

## Next step and stop point

**Already applied focused version 1?** Do not reapply the complete patch. In the existing isolated worktree, use only `SCM-focused-v1-to-v2-next-only.patch`: first `git apply --check "<extracted path>/SCM-focused-v1-to-v2-next-only.patch"`, then `git apply "<extracted path>/SCM-focused-v1-to-v2-next-only.patch"`. It changes only `package.json` and `package-lock.json`. Run `npm ci` and repeat the tests/typecheck below. Keep the updated packet's review notes separately; the incremental patch does not modify application code, migrations or documentation in your checkout.

**Starting fresh?** Follow the complete-patch instructions below instead. Never apply both patches to the same checkout.

Use a new isolated source checkout at the base above. Do not overlay the broad review packet or a live working folder. This is the complete revised patch from the stated base; do not apply it on top of the earlier focused patch. From that isolated checkout, run `git apply --check /path/to/SCM-focused-outage-lookup.patch`, then `git apply /path/to/SCM-focused-outage-lookup.patch`. Install the existing locked dependencies with `npm ci`, then run:

`node --experimental-strip-types --test --test-concurrency=4 tests/*.test.mjs`

`npx tsc --noEmit --incremental false`

Stop after local review/tests. Do not run `npm run dev` with an existing production `.env`, deploy, or apply SQL to an existing database. Full-app acceptance requires a verified isolated test backend, synthetic data and McLeod writes disabled/mocked. The additive migrations `044_selected_checkin_stop.sql`, then `045_driver_lookup_input.sql`, must be verified/applied there before testing the new lookup application. These are an alternative to the broad packet migration sequence, not something to layer on top of that packet. Production rollout needs separate authorization and schema/version verification.

## Lookup acceptance

Both driver and staff paths must accept one requested-direction stop at the correct yard even when the same order also has the opposite direction at that yard, or earlier same-direction stops elsewhere. Check root and nested movement stop shapes. Wrong yard/direction, mismatched persisted stop, ambiguous repeated visit, missing/contradictory movement identity, non-MAIN orders and completed stops must not become a new valid arrival/write. A legacy null selected stop requires a fresh unique result.

Also test an entry that is one order’s SCM number and another order’s reference; only eligible current-yard matches should be offered. Choose by company and driver, not customer. A newly ambiguous result must require an explicit choice, even if the preceding lookup was unique.

A genuine confirmed no-match retains paperwork-only check-in. Upstream failures, incomplete data, or known ineligible-only matches require retry/office review; they do not authorize an unmatched arrival. The entered value remains unchanged in the form and is stored separately from the canonical reference.

BLNUM92157 is represented by synthetic multi-stop fixtures. Its actual McLeod stop data was not supplied; this patch does not establish that the live order is resolved. When a safe test copy is available, verify its exact stop list against both lookup paths before rollout.

## Explicit limits

This reduces known request amplification; it does not establish the root cause of the earlier outage or promise prevention of every outage. Query-plan/index tuning, large-booking work, P&L semantics, durable McLeod attempt/reconciliation and broader audit fixes remain outside this focused patch. Existing baseline ambiguous remote-success and concurrent external-write risks are not claimed solved. The preview exercise is not part of this handoff.

## Local validation

Final focused tree on Next 15.5.27: 220/220 tests passed, with no skips or failures; TypeScript and production build passed; the build used synthetic .invalid endpoints with McLeod writes disabled. SQL tests apply 044 then 045 independently in PGlite and check legacy nulls, stale binding invalidation, original-input preservation, constraints and permissions. Independent final review found no remaining blocker. Final build and test logs are included.

Unified QR tests cover SCM-only and reference-only inputs, dual-path deduplication, different orders sharing the same input, wrong-yard/completed collisions with an eligible match, company/driver ambiguity, masked phone data, partial/malformed upstream responses, aggregate deadlines, fresh-submit revalidation and newly ambiguous lookup/submit races.

Other failure tests include provider outage vs invalid credentials, background/overlapping refreshes, stale drafts/save/delete responses, wrong/stale stop and wrong movement zero-write checks, ambiguous repeated visits, and a same-yard pickup whose unverified sequence must not receive invented actuals during delivery checkout. Complete existing pickup actuals remain usable without rewriting.

Browser/full-stack acceptance and the live 92157 order are unverified. The broader packet's native PostgreSQL concurrency results are not represented as new concurrency validation for this independently extracted patch.
