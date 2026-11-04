# Cotton tariff outreach

Production path: `/cotton-locations/outreach`. Links are available from Platform Home, Location Management, and Warehouse Operations.

The first batch contains ten southeastern facilities missing saved hours, with existing name-based fee warnings prioritized. This is a provisional outreach list, not a load-volume ranking. All location master records are in the queue. Owner defaults to Hope; the text owner field does not create an account or grant permissions.

Active administrators and operators can maintain outreach records and upload documents. Viewers can read. The workflow does not grant access to location editing or fee-policy approval. Existing staff invitation flow is used for a new hire; operator access requires a terminal. No invitations are sent automatically.

Request current written tariffs first, including effective dates, pickup hours, cutoff, appointments, early/late pickup and storage fees, Friday and seasonal exceptions. Record contacts and follow-up dates. Aim to follow up after three business days. Upload all pages as PDF/JPEG/PNG, up to 3 MB per document. Larger PDFs should be compressed or split.

Uploads are stored in a private `cotton-tariffs` bucket. Server-authenticated downloads use 60-second signed URLs. File signatures are checked; no public storage policies are granted. Successful uploads automatically mark the facility received, including uploads to previously reviewed facilities. Save record edits before uploading.

Received and reviewed are distinct statuses. Review requires an administrator, at least one uploaded document, and a tariff effective date. Outreach review is documentary review only; it does not change active fee calculations or confirm schedules. Admins use the existing location modal to save source-backed hours and fee drafts. All outreach changes and document receipts are audited; stale versions cannot overwrite later changes. No messages, calls or emails are sent by the queue.

## Previously supplied sources

The source inventory in `lib/cotton-locations/existing-tariffs.ts` records fifteen previously supplied tariff files. Nine are linked to twenty locations using explicit warehouse codes and/or matching addresses; six remain visible in the inventory pending mapping, scan review or resolution of conflicting warehouse codes. File presence does not establish that a tariff is current or approved.

The queue displays existing-source coverage separately from new uploads and outreach status. Untouched outreach rows with matched sources show “On file · needs review”; users can filter to existing tariffs. The modal instructs staff to confirm the existing version and collect gaps rather than blindly request a first copy. These older source links open the original files and retain their existing access controls. An admin must attach a copy through the private uploader for staff who cannot access those links and before the current received/reviewed workflow can complete. No fee rules or schedules are activated from the inventory.
