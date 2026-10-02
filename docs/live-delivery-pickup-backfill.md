# Pickup actuals for confirmed live deliveries

When staff confirm a live delivery, missing shipper pickup actuals use the former
check-in sheet uploader's fallback:

- Pickup arrival: **08:00 on the calendar day before receipt**.
- Pickup departure: **08:05 on that same previous day**.
- Cotton delivery arrival/departure: recorded check-in and verification times.
- Lumber/other delivery arrival/departure: recorded check-in and checkout times.

Cotton uses the row's received date. Lumber/other uses the date of check-in at
the receiving warehouse. Generated times use the receiving terminal's timezone:
Savannah is America/New_York; Houston is America/Chicago. The previous day's
offset is calculated independently so daylight-saving changes are handled.

These pickup times are inferred fallback values, not observed driver events.
The live cotton response identifies generated fields in `plannedActions`.

## Posting behavior

The change applies only when completing a delivery, never during lookup or an
ordinary driver arrival. It does not change the older Excel uploader branch.

Every existing pickup actual is preserved. If only one actual is missing, only
that value is generated. Recorded delivery actuals are also preserved. If the
fallback conflicts with the existing timeline, processing stops for staff review
without writing either stop. Ambiguous orders with multiple pickup stops and
missing actuals also require review.

The pickup update must succeed before the delivery update is attempted. If it
fails, delivery is not posted. If pickup succeeds but delivery fails, the next
attempt reads the order again and skips the now-complete pickup. A failed domestic
delivery leaves the truck's checkout unsaved. Existing shortage, matching,
duplicate, and sync-enabled checks remain in place.

Cotton preview mode returns the planned pickup and delivery values without
posting them. Domestic checkout continues to reject writes when sync is disabled.
No migration, credential change, or change to MCLEOD_SYNC_ENABLED is required.

## Verification

```bash
node tests/checkin-pickup-backfill.test.mjs &&
node tests/checkin-pickup-backfill-routes.test.mjs &&
node tests/checkin-mcleod-time.test.mjs &&
node tests/checkin-mcleod-order-id.test.mjs &&
npm run build
```

The route tests execute the real handlers with mocked McLeod and database
boundaries. They cover write ordering, preserving actuals, preview mode, pickup
failure, delivery retry, validation failures, and ordinary pickup checkout.

For a live check after deployment, use a confirmed delivery whose pickup actuals
are missing. Confirm the previous-day 08:00/08:05 pickup values and real delivery
times in McLeod. A second example with existing pickup actuals should leave those
values untouched. Tests do not themselves prove live API behavior.
