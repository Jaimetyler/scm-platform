# Partial pickup departure repair

A pickup with an existing actual arrival but no departure could be assigned the fixed previous-day 08:05 departure. If the actual arrival was later, chronological validation blocked cotton checkout before any vendor write.

For a partial pickup, preserve the original arrival string and infer only the missing departure as arrival plus five minutes, formatted with the warehouse timezone. Fully missing pickups retain the existing previous-day 08:00/08:05 fallback. Completed actuals remain unchanged. Chronology validation still blocks a pickup departure later than delivery arrival, and the existing durable write-pending fence still prevents blind retries.

Order 0827066 (BU168, HOU 5300) is currently processed/complete following the user's manual correction. The original error is no longer present in the saved SCM row, and the original vendor timestamps were not fetched; the reported order's historical root cause is therefore not independently certified. The partial-pickup bug is reproduced with synthetic handler tests.

Validation: 30 targeted tests passed and TypeScript passed locally. New coverage includes afternoon pickup arrival, crossing midnight, ISO timestamps, and rejection when the inferred departure would follow delivery arrival. Full suite and CI results must be checked for this commit.

No schema migration is required. This follow-up is not deployed to production. Production remains e69cc1b. Already completed order 0827066 must not be retried or modified as a test.
