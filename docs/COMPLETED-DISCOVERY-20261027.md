# Unlinked completed cotton discovery

The staff Finish cotton flow could discover an exact mark in McLeod, persist known-candidate evidence, then exclude that delivered order from open-order processing. With no saved order ID it returned KNOWN_MATCH_NOT_FOUND and left the arrival active. Production logs for reported marks B0964 and D0943 showed delivered orders 0826934 and 0827074 respectively. They are not evidence of a genuine no-match.

After this specific pre-write failure, staff checkout performs fresh strict discovery with completed deliveries permitted only for reconciliation. It requires one exact expected-customer match, the current date window, and complete existing arrival/departure actuals. A second exact order/yard verification and existing mark/customer/bale-count validation run before binding the order/stop with a revision check. Completion uses the existing audited 048 SCM-only RPC. It never clears known-match evidence or sends McLeod writes. New-driver and ordinary live-sync lookup remain open-order only. Incomplete, contradictory, multiple, cancelled, undated or historical matches stay blocked.

Validation: 371 root tests and TypeScript passed locally. New real-handler regressions cover unlinked delivered discovery, one-time SCM completion, unchanged remote actual strings, zero vendor writes, replay, and wrong yard/customer/bale count/missing actual rejection. True no-match receiving and uncertainty fences remain covered.

No migration is needed. This change is a candidate until its exact CI/build and production approval are recorded. No production receiving rows were changed during development.

The preceding pickup-departure fix 1028281 was approved and deployed as dpl_FSnuauWGjrNGgnpgqY5JvR3BbbHT, production target READY, exact Git SHA recorded. Both production aliases were verified on it; no schema changes or vendor writes were made for that code-only rollout. Immediate runtime-error query was empty. Rollback for the pickup hotfix is dpl_DZNeccoD8RXCJdxcTKEBKTht1Cm3. PR remains unmerged.
