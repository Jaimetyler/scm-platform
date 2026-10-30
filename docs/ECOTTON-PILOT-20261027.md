# Houston eCotton production pilot — October 27, 2026

User approved production rollout plus ONE create/rate pilot only. Other 28 invoices and delivery remain out of scope until separately approved. Draft PR #4 remains unmerged.

## Backup and production rollout

User-held archive: `C:\DEV\scm-backups\scm-before-import-b49a214-20261027-163744.dump`, 1.8 MB. User ran the prepared set-e backup/archive-index/checksum script; supplied SHA-256 `c5a859746076317987ca817a57b309f681241ebd40242e314a299948efa320ee`. This fresh archive was not restore-tested by the agent; earlier baseline application restore had passed.

Applied only the additive eCotton ledger migration to production iurnpebmdfbjttejlymr, recorded as version `20261027203939` / `ecotton_import_ledger`. RLS and no anon/authenticated table reads verified. No earlier warehouse migrations replayed.

Initial rollout: source b49a21446a96d58c64a6d1984c835b7855579b6d, production deployment dpl_JCdc1b8NwkbosRqifoYoP9xLLfth. Broad web creation/rating remains disabled by production ECOTTON_IMPORT_WRITES_ENABLED=false. The approved pilot used the committed import engine with authorized SQL-connector ledger transitions and a tightly scoped live vendor adapter. This is not a claim that the hosted HTTP write action was exercised through a user's browser.

## Pilot source and receipt

- BOL 52795, mark TZH34, customer ECOM USA LLC / ECOMDAT1.
- Invoice date 2026-10-20; HOUWHSE pickup AND delivery; HLOCA / ECOTTON.
- Expected amount and planning comment: $911.40 / `911.40`.
- Six charges preserved: HC23 -378.40; HCH 264.00; HC02 352.00; HCS 52.80; HCS 616.00; HBLT 5.00.
- Fresh complete pre-create search returned no matching order.
- McLeod created order **0828170**, movement **649341**; creation ID saved before any further vendor write.
- Production run `debd77c4-ce58-4224-a627-bb79b88b53fb`, ledger row `1eb489cd-fa56-4430-9cde-6b8056f374de`.

## Carrier issue found and repaired

Live create accepted the order/charges but did not retain nested movement override defaults. Strict read-back blocked before autorate. No duplicate order was created.

A follow-up whole-order PUT /orders/update was rejected with HTTP 406, `Carrier code must be filled in with a valid payee`. Read-only inspection confirmed the order remained Available with no stop actuals and no movement overrides; the failed request was recorded in the audit trail. That approach is not used by the repaired importer.

The documented TableRowService PUT /movement/update successfully stored carrier SCMIRIGA, fixed F, one unit, override_paye_rate=0 and override_pay_amt=0 using only the saved movement primary key/company and whitelisted payment columns. It did not populate override_pay_rate, which left the desktop Rate field blank. An initial permissive verifier treated that omitted field as acceptable; the user correctly rejected that interpretation. The production ledger was reopened from verified to blocked with an append-only correction event. That permissive verifier was never deployed to production and has been removed from the corrected source.

The documented POST /carrierDispatch/setPay/649341?method=F&units=1&rate=0&carrierPay=0 returned `Override/Carrier pay amount successfully updated.` A fresh GET then confirmed ALL required fields explicitly: override_pay_rate=0, override_paye_rate=0, override_pay_amt=0, SCMIRIGA/F/1. Missing or blank rate/amount values now fail verification. No additional order creation or repeated autorate occurred during this correction.

The pilot's single POST /orders/autorate/0828170 completed before the final explicit-zero correction and was followed by a fresh order GET; the explicit-zero correction was then followed by another fresh complete verification. Final result: all six source charges, total 911.40, correct customer/reference/mark/locations/dates/planning comment, SCMIRIGA, both rate fields explicitly zero, zero carrier pay, zero linehaul. Order and stops remain Available (A), actual arrival/departure fields remain null. No delivery endpoint was called. Final ledger state verified, version 13. All claim, failure, repair-intent, user-correction and completion events remain in the production audit ledger.

## Repair in the shared importer

For an order created by this import, the existing persisted rating claim now fences both movement setup and autorate. Before movement setup it verifies identity, charges, still-Available status, no stop actuals, one saved movement, and no conflicting carrier/rate/payment. It fills only missing/compatible approved defaults via the targeted movement endpoint, calls the documented setPay operation with fixed F / one unit / explicit zero rate and carrierPay, reads back every required field, then autorates once. Any setup timeout or unreadable result leaves rating_uncertain; no blind replay or claim takeover. Existing differing McLeod orders are still never automatically modified.

Regression coverage includes the actual live response shape where create omits movement defaults; a single targeted setup before autorate; setup uncertainty without retries; preservation of unrelated fields; refusal to overwrite a different carrier, nonzero pay or actuals; strict rejection of every missing/blank rate or amount, explicit carrier-pay initialization, and uncertainty fencing before autorate. Full local suite 416 passing, TypeScript passes. Real pilot endpoints proved create, targeted movement update, and autorate; simulated tests cover failure/concurrency paths.

Primary API contracts inspected:
- https://tms-dsly.loadtracking.com/ws/docs/services?service=OrderService&operation=createOrder&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/services?service=OrderService&operation=updateOrder&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/services?service=TableRowService&operation=update&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/services?service=OrderService&operation=autorate&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/services?service=CarrierDispatchService&operation=setPay&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/types?type=com.tms.common.loadmaster.tablerows.RowMovement

## Remaining scope and rollback

Remaining Houston invoices: 28, expected total $23,466.28; no create/rate/delivery writes were sent for them. Broad web writes stay disabled pending approval. Dallas and Savannah still require acceptance with untouched source report samples before general operational use.

Keep ECOTTON_IMPORT_WRITES_ENABLED=false to stop new creation/rating. Retain all ledger/audit/assigned-ID records. App rollback cannot undo McLeod order 0828170; do not delete its source ledger or recreate it. Prior application baseline is 2b1af0b / dpl_6WACjEuf1br9HkxvBLgRANnefSz1; existing additive schema and pilot receipts must be retained on rollback.
