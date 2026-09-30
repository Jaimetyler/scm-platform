# Outbound mark actions and source loads

Apply migration `039_outbound_mark_lifecycle_and_source_loads.sql` in Supabase before deploying this patch.

## Import review

Choose the warehouse and upload the customer booking request. The review shows editable ERD, doc cutoff, cutoff, and vessel fields. Confirm the captured/corrected dates before saving; changing a date clears confirmation. Cutoff times are optional warehouse-local times. Unknown dates may remain blank after review. Past sailing dates and ERD-after-cutoff show review notices; neither prevents an explicitly confirmed historical request from being saved.

Legacy load-by dates may be old, missing, or unreadable. They do not gate import or the warehouse loading window. Unreadable sailing dates remain blank with a notice rather than shifting to an invented date. A sheet whose stated bale total differs from its mark rows still requires correction.

Rows matching the selected warehouse become warehouse loads. Other-location rows are retained as **Source loads**, representing direct pickup into an export container. The source location and shipping order remain stored. Source rows appear below active warehouse rows and do not count as missing warehouse inventory. Review these classifications, especially when importing a request that lists only other locations.

## Mark actions

Each mark row has **Put on hold**, **Resume**, and **Cancel mark** actions. Optional notes record why the plan changed.

- Hold retains the mark and requested bales while locking its equipment and split actions. Resume returns it to the active plan.
- Cancel removes the mark's requested bales from the booking total, including when cancelling the last mark. The cancelled row and saved equipment remain locked at the bottom, with an audit event. Cancellation does not change warehouse inventory or McLeod delivery. Use hold when awaiting information; cancelled marks cannot be resumed.
- Source loads can be converted to warehouse loads manually. This changes planning only. Checked in and In warehouse continue to depend on actual receiving records, rather than the conversion itself.

Saved equipment is retained through these actions. Finish or clear unsaved equipment before changing that mark's plan. Other marks' pending equipment remains in the page. Database locks and the booking version prevent stale actions and equipment saves from silently reactivating held/cancelled marks. Source classification follows both partial and full splits.

## Missing marks and ERD

Dashboard cards count distinct active warehouse marks whose physical warehouse bales are below their requested bales on that booking. Thus both an absent mark and 87 received of 90 requested count as one missing mark. Active/on-hold physical inventory counts as present, including allocated inventory. Checked-in trucks remain missing until receiving completes. Held, cancelled, and source loads are excluded and have separate counts where applicable.

Use **Filter by ERD** to apply Today / Next 7 days / Past to the ERD instead of cutoffs. **By ERD** groups cards by receiving date. Warehouse, date basis, grouping, and search persist through navigation. Dashboard counts refresh every 30 seconds.

## Unexpected source arrivals

An exact cotton delivery-mark check-in matching a source load on an active booking creates a persistent alert, including QR check-ins and arrivals at another warehouse. A source row imported after its truck is already in the active line is also flagged. Pickup check-ins and unrelated marks do not trigger the alert. Completion/checkout does not erase an unreviewed alert.

Alerts appear on the cotton receiving grid, domestic line, dashboard, and booking details. Receiving may continue. Review the booking to **Convert to warehouse load**, or **Keep as source load** with an explanatory note. Those actions resolve the alert. A later separate check-in can create a new alert if the mark remains a source load. Alerts identify a possible plan change; they do not prove receipt or allocate inventory. Notifications are in SCM screens.

## Container information

**Send container info** downloads a compact `.xlsx` for sharing. Its header includes customer, booking, customer reference, warehouse, vessel, ERD, doc cutoff, and cutoff. The table contains only mark, container number, and seal number. It includes active warehouse and source loads, omits held/cancelled marks and split history, and reads saved equipment. Warehouse printing similarly excludes held/cancelled marks from loading rows and lists them in an exclusion note; source loads are labelled and listed below warehouse loads. The existing full Excel export retains all rows with their status.

The button downloads a file; staff can attach it to their customer message.

## Validation

Run `node --test tests/outbound-source-lifecycle.test.mjs tests/outbound-bunge-details.test.mjs tests/outbound-dashboard.test.mjs tests/outbound-add-mark.test.mjs tests/outbound-booking-splits.test.mjs tests/outbound-booking-details.test.mjs` and `npm run build` with normal deployment environment variables. SQL integration tests cover totals, locks, exact source matching, alert persistence/resolution, partial/full split classification, and inventory preservation.
