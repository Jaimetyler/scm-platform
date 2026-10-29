# Dallas eCotton billing repair — pending live validation

User confirmed Dallas location codes SCMDDETX and SCMDDATX; ECOTTON loads use the same location for pickup and delivery.

Uploaded preview response (604 raw rows / 86 references) contains 61 single candidates, 23 distinct multiple matches and 2 lookup failures. References 100/101 failed with HTTP 500: location SUPPGAGA not found. No evidence yet identifies the offending order or establishes that the narrowed query avoids the missing location.

Changes require an explicit Dallas warehouse selection. Shared Preview/Apply lookup uses qualified advanced-search order fields (exact input BOL, ECOTTON, DLOCA), bounded pagination, ID deduplication and hydrated order checks. Eligibility requires exact reference, ECOTTON, DLOCA, precisely one PU and one SO, both at the selected warehouse. Any same-warehouse ambiguity remains blocked. Full pages at the retrieval bound, unknown response shapes and vendor errors fail closed. No undocumented location-query field is used.

UI displays lookup errors and disables Apply for unresolved batches. Server independently blocks unresolved preview rows, redoes matching, and refuses a changed order ID before each write. Non-Dallas lookup behavior is otherwise retained.

Validation: unit coverage for cross-warehouse collisions, duplicate IDs, exact reference/type/revenue, mixed or additional stops, missing warehouse, malformed responses, vendor errors, pagination exhaustion and same-warehouse ambiguity. TypeScript and full suite results recorded in release report.

Release gate: exercise read-only live preview with the original CSV for each warehouse; verify qualified search filter behavior against actual McLeod, hydrated stop structure, and intended orders for references 95/100/101. Local fixtures do not establish vendor compatibility. No real McLeod charges or production data changed. Production release requires explicit approval. No migration. Rollback to previous deployment; retain all operational records.

Existing billing risks outside this repair: Apply may partially succeed across a batch; whole-order PUT and autorate are not protected by warehouse checkout's durable uncertain-write audit fence. Do not blindly retry an interrupted or unverified apply; inspect actual charges first.

## Uploaded CSV validation

843001 BillingSummary explicitly maps all 86 orders to SCMDDATX, including reference 100 / order 0827942 and 101 / 0827943. The two 843001 detail uploads are byte-identical. 875260 detail header identifies Supply Chain Management Dallas, but the uploaded files do not explicitly establish its McLeod location code; do not infer that mapping from elimination.

Actual local preview handler replay, with synthetic tariff mappings and simulated McLeod reads: 843001 = 86 references, 517 charge lines, $21,754.72; 875260 = 20 references, 111 charge lines, $6,017.16. Both agree with report footer totals, no skipped tariffs under those synthetic mappings. This verifies parsing only, not real mapping correctness or real order matches. CSVs remain private and are not committed. Summary is reconciliation evidence, not a supported detail-upload input.

Found/fixed amount-header compatibility: accept both TotalCharges and Total Charges; reject files missing quantity/amount headers instead of silently defaulting all amounts to zero. Blank-description per-reference subtotal and grand-total rows remain excluded. Added actual-handler regression coverage.

Operations subsequently confirmed 875260 = SCMDDETX. Exact recognized report headings now auto-select the confirmed warehouse; server preview independently rejects a conflicting selected warehouse. Unknown headings retain explicit selection. This supersedes the earlier unresolved mapping note.

## Staging dependency repair

User preview exposed two staging-only setup gaps: missing billing_charge_description_xref and warehouse simulator configured as MCLEOD_BASE_URL. Provisioned description table with RLS and server-only grants, copied 25 active Dallas description mappings and 18 tariff mappings from production configuration. No production writes. Separate branch-scoped MCLEOD_BILLING_READ_BASE_URL / MCLEOD_BILLING_READ_AUTH_TOKEN now provide real order reads only to the preview route; existing warehouse simulator and MCLEOD_SYNC_ENABLED=false remain intact. Preview fetch explicitly uses GET, no-store, and a 20-second request timeout. Apply does not consume these read-specific variables.
