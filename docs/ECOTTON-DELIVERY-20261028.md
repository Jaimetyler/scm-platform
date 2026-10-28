# Houston eCotton delivery

Adds reviewed delivery to the existing saved import run. The scope is HOU-HOUWHSE only. Creation/rating remains independently available; no email intake or automatic delivery on import is introduced.

## Operator flow

Open `/ecotton-import?run=a7e1e93e-8451-40de-85f1-967b4edbf1b4`. Select verified Houston orders (or individual rows), choose Preview delivery, review the exact McLeod order/movement/stop IDs and scheduled values, then Deliver reviewed orders. Each order is processed sequentially; any uncertain result stops the batch.

The exact stored `sched_arrive_early` becomes `actual_arrival` and `sched_arrive_late` becomes `actual_departure` at each stop, without date conversion or synthetic times. Existing conflicting actuals block processing. Stop and order statuses become D; movement status D, brokerage_status FINISHED, order ready_to_bill true (API boolean equivalent of import Y). Narrow row updates preserve charges, carrier and pay.

The route retains administrator-only authorization, same-origin enforcement, saved-run membership/source-conflict checks, explicit confirmation, and both existing write flags. A preview digest and fresh vendor read prevent stale schedules from being submitted. A versioned database claim persists the exact schedule snapshot in the row note and append-only audit event before the first vendor write. Competing clicks cannot claim the same order. Partial writes are fenced in delivery_uncertain; reconciliation only reads and verifies, never retries writes. A crash while delivering uses the same read-only reconciliation after five minutes.

## Vendor API

- PUT `/stop/update`: only primary key, company, actual arrival/departure and status.
- PUT `/movement/update`: only primary key, company, status and brokerage status.
- PUT `/orders/updateRow`: only primary key, company, status and ready-to-bill.
- GET `/orders/{savedId}` verifies the full result, schedule snapshot, invoice charges/total and carrier defaults.

Official documentation inspected: https://tms-dsly.loadtracking.com/ws/docs/services?service=TableRowService&operation=update&role=-1 and https://tms-dsly.loadtracking.com/ws/docs/services?service=OrderService&operation=updateOrderRow&role=-1 . updateRow intentionally does not cascade stop/movement changes; those are explicitly updated first.

## Verification

- Existing full suite plus delivery tests: 422 passed; subsequently added route authorization/preview guard regression passed (423 total defined tests).
- Focused delivery/routes: 9 passed, including concurrent claims, invalid/stale/missing schedules, conflicting actuals, wrong identity/movement, charge mismatch, every partial-write boundary, read-only reconciliation, and migration audit/fencing.
- Existing synthetic acceptance: 65 local fixture checks and 41 hosted adapter assertions passed, vendor writes simulated.
- TypeScript passed. Production build checked separately in release verification.
- Real read-only production preview: 29/29 saved Houston orders verified, zero existing actuals. Scheduled dates: October 12, 19, 20, 21, 22, 23, 2026, retaining stored -0400 offsets.
- Staging migration applied; remote rollback-only SQL claim test confirmed a stale second claim returns zero rows. No synthetic rows retained.

No real delivery writes were performed during implementation. The first live delivery must be checked in McLeod; mocked writes cannot establish vendor business-rule behavior.

## Rollback

Prior production deployment `dpl_EfZyR8FhzwKbmuxzsSND27AgYEAd`, source `748e11eeadcafb5394e485851fbb460a228a2d7a`. Roll back app aliases if needed while retaining additive delivery ledger states and audit history. Do not reset uncertain rows, restore stale data, or replay partial delivery writes. No existing rows are rewritten by the migration.
