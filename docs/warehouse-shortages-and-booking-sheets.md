# Cotton shortages and warehouse booking sheets

Run `supabase/migrations/037_inbound_cotton_shortages.sql` before deploying this change.

Drivers can check in a short cotton delivery through the QR form. They can enter the bales on the truck when that differs from the BOL. McLeod's verified order quantity supplies the expected count when an order is linked; otherwise the BOL supplies it. A successful short check-in tells the driver to speak with warehouse staff. Driver-reported quantities never create inventory.

Staff enter the actual unloaded count and acknowledge the shortage with a note. Completed receiving is labeled `Receiving complete`, with database status `delivery_blocked`. This creates one inventory receipt for the actual unloaded bales and never posts a McLeod delivery. Completing receiving and recording the truck's yard departure are separate from delivering the order in McLeod. Receipt quantities cannot be edited after this shortage completion; Notes and customer follow-up remain editable.

The shortage records expected and actual counts, a note, who acknowledged it, and when. Changing counts before receiving completes invalidates an earlier acknowledgement and customer notification. The event table retains the earlier acknowledgement. Customer notification stays pending until staff contact the customer themselves and record the notification with a note. The application does not send that email. Damage, wet freight, missing tarps, and follow-up belong in the existing Notes field.

Live matching excludes already delivered/closed orders and deliveries scheduled more than 45 days before or after the arrival date. Missing delivery-date evidence requires review. Historical Excel import behavior is unchanged. Existing processed test records are not rewritten by this migration.

Booking rows show a green bale count when it matches the total requested for that mark, or a red count such as `87 of 90` when it differs. Hovering explains whether the count is in warehouse inventory or reported in the delivery line; a matching reported count does not itself mean receiving has finished.

Use **Print warehouse sheet** on a booking to open the saved booking's printable view. **Print / Save PDF** opens the browser's print dialog. The sheet uses Letter landscape, repeats the booking details and column headings on additional pages, and includes customer, booking reference, vessel, ERD, cutoffs, marks, requested bales, inventory locations, shipping orders, and saved container/seal/chassis information. Blank cells allow warehouse handwriting; split history appears separately. Save final equipment information in SCM. The print view includes every mark, even if it has no equipment slot yet, and uses saved values rather than unfinished edits.
