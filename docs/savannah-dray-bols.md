# Savannah dray BOLs and McLeod imaging

The existing Savannah Dray Import run supports selecting saved verified/delivering/delivered orders to download a ZIP of BOL PDFs grouped by booking. Order details provide an individual PDF download and a McLeod imaging action. No second upload or manually entered McLeod number is required.

The original current-format dray CSV supplies bale counts through header names (including Pickup Point in J), independently of FirstStar pay. Bale counts are stored separately on import items. Existing invoice hashes, rating and delivery state are preserved. A repeated preview can fill missing bale metadata; conflicting saved counts require review. The nine existing orders were backfilled from the previously supplied Oct 24–30 report after matching source identity, mark, booking and shipper order.

The BOL uses SCM's supplied logo and signature, saved McLeod order ID, shipping order, loaded date, shipper, mark, bales, customer SO, booking, full container, chassis and seal. Filenames contain mark, container and McLeod ID. Artwork is embedded only in server-side code and is not exposed as public signature assets. PDFs are deterministic; downloads are private and uncached.

Every generation and upload rechecks saved run membership, source hashes, conflict state and live McLeod order identity. A document never creates, rates or delivers an order. Missing fields and ambiguous references block generation. Downloads permit up to 100 selected BOLs. Document operations use existing active admin/same-origin authorization and staff request auditing.

McLeod imaging uses the installed API's documented raw-PDF POST /images/O/{orderId}/{documentTypeId}, not a guessed multipart endpoint. Available document types are read from GET /images/O/{orderId}/documentTypes. A staff member chooses the type and explicitly sends the BOL. Existing documents of that type block another upload. The existing write enable flags apply.

A private imaging ledger reserves (McLeod order, PDF SHA-256) before any upload, preventing concurrent/repeated submissions. HTTP errors/timeouts leave an uncertain receipt and never automatically retry. A successful POST is staged until its returned ID is visible under the same order, company TMS and document type. A batch receipt is not claimed as indexed. Check indexing only performs reads. An unknown/staged receipt requires McLeod review if the provider cannot correlate the batch ID. No live imaging upload was performed during implementation.

Official contracts inspected:
- https://tms-dsly.loadtracking.com/ws/docs/services?service=ImagingService&operation=addImage&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/services?service=ImagingService&operation=getImageTypes&role=-1
- https://tms-dsly.loadtracking.com/ws/docs/services?service=ImagingService&operation=getImageList&role=-1

Validation: BOL source/identity/PDF/migration tests; imaging membership, confirmation, type, flags, timeout and duplicate-claim tests; existing dray and staff access regressions; mocked browser flow for delivered-row selection, ZIP/individual downloads, document type selection and staged status; rendered PDF compared with the supplied sample. Live provider type availability and first upload still need an authenticated operational check.

## Private PDF archive

Generation now saves each PDF in the private `savannah-dray-bols` Supabase bucket before returning a download or sending to McLeod. The `dray_bol_documents` table records the immutable source identity, bale count, plan hash, PDF SHA-256, filename, size and signed-in actor. Duplicate generation reuses the existing PDF. Files are never overwritten. Upload races are resolved by verifying the stored bytes, and a storage/hash/record failure blocks imaging submission.

The imaging receipt links to the archived document. McLeod receives the bytes downloaded and hash-verified from private storage. A saved-copy GET endpoint checks run membership and source identity and streams the PDF through existing administrator authorization; neither a public URL nor a client storage policy is created. Individual downloads use the saved copy first, so a McLeod outage does not prevent retrieving an already generated BOL. ZIP downloads also reuse archived copies. No SharePoint or Microsoft connection is needed for this archive.

Additional verification: storage save/read-back/reuse and corruption tests, private bucket/RLS/grant checks, saved-copy download without a McLeod connection, failure-before-send checks, and browser download/upload flow. Production bucket is private, limited to PDF files up to 3 MB, and has no client storage access policies.
