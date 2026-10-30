# Staff outside-carrier checkout and compound reference correction

Local review only. No production deployment or migration application is authorized by this packet.

## Scope

- A failed, demonstrably read-only McLeod lookup can offer staff **Retry Search** or **Process as Outside Carrier**. The latter uses one clearly labelled confirmation action. No typed reason or extra checkbox is required; the server supplies a fixed audit explanation and retains the actual typed lookup failure.
- The server and database verify the active staff account, terminal, current row revision and lookup attempt. Viewer accounts and other-terminal operators cannot authorize it.
- Manual completion records an immutable event with actor, time, server-generated explanation, original and completed row snapshots, and unresolved verification status. Receiving fields, arrival, driver/carrier/reference, paperwork paths and notes remain attached. The movement leaves the active line and creates its normal inventory receipt atomically. It does not call McLeod.
- A known order/stop, observed matching candidate, uncertain write, shortage requiring its existing separate workflow, or stale revision cannot be silently treated as outside carrier.
- Repeating the same confirmation returns the original completion. A different confirmation does not create a second event or receipt.
- Interrupted read-only lookups can be fenced and retried. A request that may have written externally requires reconciliation, not a blind retry.

## Receiving-screen navigation

A persisted cotton failure links directly to the same yard’s checkout-review row in a new tab, preserving the receiving page’s edits. The destination refetches eligibility and revision; a URL never triggers completion. Refresh receiving after a completed review.

## Reference semantics

Both stored values and entered values ignore whitespace immediately around `/`. For example, `81382 / 49001932`, `81382/ 49001932`, `81382 /49001932`, and `81382/49001932` are equivalent. Either standalone token matches at a whitespace, slash or hyphen boundary. Numeric substrings do not match; leading zeroes and meaningful hyphenated references remain significant.

For a compound input, retrieval uses its longest necessary slash component, then verifies the entire normalized compound in the same reference field and order. It does not combine unrelated orders or discard contradictory input. Original entered and stored display values are retained. Compound order and other internal whitespace are currently significant; no arbitrary token reordering is inferred.

The request/page budgets remain bounded. A full last page is incomplete, never a unique result or proof of no match. Standalone `2951` remains an open live-data retrieval issue: its broad search exhausted 20 successful pages / 100 raw records on October 9. Normalization does not solve that volume issue. Live diagnostics proved exact-only search misses the compound load. Prefix/boundary retrieval found the intended compound record, but the vendor returns an unexplained 500 for the left-hyphen pattern. Neither shortcut is shipped; dense standalone retrieval remains unresolved.

## Migration and deployment gates

Migration `046_staff_outside_carrier_checkout.sql` is applied only to the isolated SCMStaging project; production application remains pending. This confirmation revision adds no migration and does not rewrite 046. It depends on existing migrations through 045. Its new versioned claim protocol, audit table, permissions and row guards must be reviewed together with the application changes.

The old claim RPC is retained for old callers. Compatibility guards distinguish legacy processing from versioned attempts; old callers cannot consume or settle a protected versioned attempt. An application rollback must retain the migration and audit data. Newly managed or uncertain rows can remain blocked under old callers and require the new workflow/reconciliation; do not drop audit columns or loosen guards to make an old caller retry.

Only the exact server-persisted legacy pre-write cap failure recognized by the implementation can admit a fresh lookup. Its text alone never authorizes manual completion. Generic old failures have no reliable write provenance and remain review cases.

Before any release: verify current schema, migration name availability, app commit, permissions, old/new caller compatibility and in-flight behavior. Obtain explicit approval for migration and deployment. After release, verify the production alias explicitly: the existing Vercel rollback means a Git push alone does not prove the new build is serving.

## Validation boundary

Automated route/component tests use synthetic data and mocked network boundaries. The native PostgreSQL harness creates a fresh loopback-only cluster, runs migration and independent-session contention tests, then stops it. It never reads an existing database URL or production credentials.

No real browser check-in submission, McLeod mutation, production SQL, or hosted staging validation is represented by these tests. Actual reference retrieval and full browser flow remain separate release validation steps.

## Recorded local checks (October 13, 2026)

- 321 tests passed: `node --test tests/*.test.mjs`
- TypeScript passed: `./node_modules/.bin/tsc --noEmit --incremental false`
- Production build passed with synthetic `.invalid` service endpoints and `MCLEOD_SYNC_ENABLED=false`; no production configuration was loaded.
- 12 native PostgreSQL scenarios passed on both 17.6 and 18.4: `node tests/integration/outside-carrier-postgres.mjs --tooling /tmp/scm-pg-tooling`. Four distinct backend sessions and observed lock waits exercised contention. The 17.6 run matches the production major/minor version, but remains local transaction evidence, not hosted-environment certification.
- Independent review covered audit grants/immutability, staff scope, legacy/v2 compatibility, known-match and uncertain-write fencing, component retry/confirmation states and strict incomplete-response parsing.

The native harness requires PostgreSQL binaries under the selected tooling directory's `package/native` and the `pg` driver under its `node_modules`. It creates only disposable fixture data. Do not point it at an existing database or substitute production connection settings.
