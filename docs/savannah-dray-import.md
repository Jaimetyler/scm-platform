# Savannah dray import

`/dray-import` is administrator-only and uses the same table/modal review pattern as eCotton. Dallas and Houston have no active dray rates yet. eCotton mappings and payment defaults remain separate.

Upload the original new-format dray CSV and one-sheet FirstStar XLSX. Reports are mapped by headers rather than positions. Skip NOBILL and missing port/steamship rows. GPA selects SAVPORT; OT, O T and Ocean Terminal select SAVOT. Unknown ports/customers and missing/ambiguous carrier matches block that row.

FirstStar terminal 700, non-voided moves only: match the four-letter prefix and six-digit serial; preserve the full dray container. A matching file reference corroborates/disambiguates a container match; conflicting references block. Match column Total directly to carrier pay. Export enough dates to include late-entered moves. No arbitrary nearest-date selection.

Mappings: mark → BOL, full container → consignee reference, file → planning comment, booking → Ordered By. Warehouse pickup is SAVWHSE; destination is SAVPORT/SAVOT. Type FLAT, revenue LOCAL, commodity COTTON, equipment C, mode T, payee SCMIRIGA. Chassis/seal/steamship and FirstStar load remain in the saved review. Shipping order + container is the durable source key; McLeod duplicate checks use mark and full container.

Customer base/chassis amounts are in `lib/dray/model.ts`, in integer cents. Olam retains its separate $0 GARDEN CITY TO SAVANNAH invoice line and 2 × $45 chassis. Other customers have 1 × $135 chassis. Base billing and separate charge lines are sent directly, without McLeod autorating; exact base, total, lines (including $0), route and carrier pay must pass read-back verification.

The import ledger uses separate dray tables and compare-and-swap transitions. Repeat uploads reopen saved runs. Source changes conflict after a write-capable state. An initially blocked missing-source row may be corrected by uploading complete files before any vendor write. Timed-out/partial creates, pay/rate updates or deliveries stay fenced for read-only reconciliation; no automatic retries.

Delivery remains a separate reviewed operation. Preview captures saved scheduled earliest/latest dates, validates order/movement/stop linkage and amounts, and hashes the plan. Confirmed delivery copies schedules to actuals, sets movement Delivered/FINISHED, and marks the order delivered/ready to bill. Charges and pay are verified again afterward.

## Release checks

Apply the additive `*_dray_import_ledger.sql` migration to the intended staging database first. Enable `DRAY_IMPORT_WRITES_ENABLED=true` and `MCLEOD_SYNC_ENABLED=true` only in the intended test environment; eCotton's write flag does not enable drays. Use existing McLeod read/write connection variables. No runtime credentials belong in the browser.

Run `node --test tests/dray-import*.test.mjs tests/ecotton-import*.test.mjs tests/ecotton-delivery.test.mjs` and TypeScript checks. Browser mock checks validate table search, filtering, selection, modal keyboard interaction and mobile layout; they do not establish live McLeod compatibility.

The supplied October 24–30 report and expanded terminal-700 export reconcile to 9 eligible loads, 10 skipped, $4,295 revenue, $1,820 carrier pay, $2,475 gross margin. Before production, test a genuinely new order in staging and verify direct rate persistence, carrier dispatch payment and retention of Olam's $0 line against actual McLeod responses. Neither the migration nor any live order write is performed by the local tests.
