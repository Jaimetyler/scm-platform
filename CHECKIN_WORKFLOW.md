# Driver check-in rollout

1. Apply `supabase/migrations/007_inbound_checkin_processing.sql` to the platform database before deploying the code.
2. Deploy the application with its existing Supabase and McLeod environment variables. `MCLEOD_SYNC_ENABLED=true` is required for live McLeod updates. With it disabled, a complete row shows **Failed** with a preview-mode message and can be retried after live sync is enabled.
3. At one Savannah or Houston site, the blank grid appears automatically. Enter a mark and customer on one line. In another browser session, confirm the row appears as **Waiting** without a warehouse location. Enter BOL B/C and move to the next field; the arrival time appears automatically.
4. Complete received date, bale count, equipment, any comments, and warehouse location last. Leaving the location field automatically finishes a complete row. It changes to **Processing**, then **Processed** or **Failed**. A failed row shows the error and has a **Retry** button. Confirm the matching McLeod stop before testing a live delivery.

## Live check-in timestamps

Apply `supabase/migrations/008_inbound_checkin_verified_at.sql` before deploying the timestamp update. It adds `checked_in_at`, `verified_at`, and `identity_corrected_at`. The existing `created_at` records when the shared row first appeared. `checked_in_at` is logged automatically when mark, customer, and BOL B/C are present (after staff leave the BOL B/C field). `verified_at` is recorded when all required fields, including warehouse location, are saved. Staff no longer needs a separate Verified checkbox. All times are stored as UTC instants; the grid displays only the arrival time in each terminal's local time, beside the existing received date.

For live check-ins, McLeod delivery arrival uses `checked_in_at` and delivery departure uses `verified_at`. The route formats Savannah in Eastern time and Houston in Central time with the applicable daylight saving offset. If staff corrects the mark, customer, or BOL B/C before processing, the same row updates automatically and `identity_corrected_at` records the correction. The original arrival time is preserved. The warehouse location is the final grid field; leaving it triggers processing after all required fields are filled. Concurrent saves from another browser return a conflict instead of silently overwriting a row; use Reload to review the latest row. Processed rows remain locked and require manual correction in McLeod.

The live check-in route does not write pickup actuals. If pickup actuals are missing, the row fails with a review message and no delivery update. The existing Excel-import route retains its separate processing behavior. The warehouse location remains on the check-in row; this change does not write that location into McLeod.

Blank lines stay in the browser until they have both a mark and customer, then they save automatically. The page starts with 25 browser-only blank lines and replenishes a line as each check-in is saved. Previously stored blank `draft` rows remain in the database but are hidden from the grid; the change does not delete them. This grid update needs no additional database migration. A processing row is claimed atomically to prevent concurrent requests from initiating duplicate McLeod calls. If a process is interrupted after the claim, the row remains **Processing** for manual investigation.

Saved check-ins display oldest first with newer check-ins below them; blank entry lines remain after saved rows.

## McLeod match outcomes

Apply `supabase/migrations/009_inbound_checkin_outside_carrier.sql` before deploying this update. After a complete live check-in, compare the customer using the mapped McLeod customer ID, not the short name typed in the grid. A confirmed match displays its SCM order number in the grid. A possible order with a conflicting mark, customer, or bale count remains **Failed** for review and shows the possible order number; do not post a delivery to that order.

If the full McLeod search returns no order for the mark, finish the check-in as **Outside carrier**, without posting any McLeod delivery. McLeod search errors or capped searches remain **Failed** for review instead of being treated as outside carriers. A failed row can be retried after a correction; previously processed or outside-carrier rows stay locked. This classification applies only to live check-ins; Excel imports retain their existing behavior.
