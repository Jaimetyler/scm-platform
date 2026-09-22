# Driver check-in rollout

1. Apply `supabase/migrations/007_inbound_checkin_processing.sql` to the platform database before deploying the code.
2. Deploy the application with its existing Supabase and McLeod environment variables. `MCLEOD_SYNC_ENABLED=true` is required for live McLeod updates. With it disabled, a complete row shows **Failed** with a preview-mode message and can be retried after live sync is enabled.
3. At one Savannah or Houston site, the blank grid appears automatically. Enter a mark and customer on one line. In another browser session, confirm the row appears as **Waiting** without a warehouse location.
4. Complete received date, bale count, equipment, and warehouse location; check **Verified**. The row changes to **Processing**, then **Processed** or **Failed**. A failed row shows the error and has a **Retry** button. Confirm the matching McLeod stop before testing a live delivery.

Blank lines stay in the browser until they have both a mark and customer, then they save automatically. The page starts with 25 browser-only blank lines and replenishes a line as each check-in is saved. Previously stored blank `draft` rows remain in the database but are hidden from the grid; the change does not delete them. This grid update needs no additional database migration. A processing row is claimed atomically to prevent concurrent requests from initiating duplicate McLeod calls. If a process is interrupted after the claim, the row remains **Processing** for manual investigation.
