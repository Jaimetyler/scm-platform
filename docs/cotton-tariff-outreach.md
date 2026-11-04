# Cotton tariff outreach

Production path: `/cotton-locations/outreach`. Links are available from Platform Home, Location Management, and Warehouse Operations.

The first batch contains ten southeastern facilities missing saved hours, with existing name-based fee warnings prioritized. This is a provisional outreach list, not a load-volume ranking. All location master records are in the queue. Owner defaults to Hope; the text owner field does not create an account or grant permissions.

Active administrators and operators can maintain outreach records and upload documents. Viewers can read. The workflow does not grant access to location editing or fee-policy approval. Existing staff invitation flow is used for a new hire; operator access requires a terminal. No invitations are sent automatically.

Request current written tariffs first, including effective dates, pickup hours, cutoff, appointments, early/late pickup and storage fees, Friday and seasonal exceptions. Record contacts and follow-up dates. Aim to follow up after three business days. Upload all pages as PDF/JPEG/PNG, up to 3 MB per document. Larger PDFs should be compressed or split.

Uploads are stored in a private `cotton-tariffs` bucket. Server-authenticated downloads use 60-second signed URLs. File signatures are checked; no public storage policies are granted. Successful uploads automatically mark the facility received, including uploads to previously reviewed facilities. Save record edits before uploading.

Received and reviewed are distinct statuses. Review requires an administrator, at least one uploaded document, and a tariff effective date. Outreach review is documentary review only; it does not change active fee calculations or confirm schedules. Admins use the existing location modal to save source-backed hours and fee drafts. All outreach changes and document receipts are audited; stale versions cannot overwrite later changes. No messages, calls or emails are sent by the queue.
