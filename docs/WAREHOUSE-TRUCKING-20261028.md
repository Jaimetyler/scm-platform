# Warehouse Intelligence: connected trucking expansion

## Delivered behavior

The historical warehouse/customer contribution report includes separately visible MAIN, CNTR, DAVIS and DDRAY segments, rolled into connected trucking loads, revenue, carrier pay, provisional gross profit and margin. Customer selection, search, location filters, ranking and monthly trends use the combined trucking metrics. The home page links to the protected report.

MAIN and every existing warehouse metric/month are preserved from the reporting branch snapshot at 328bf7e. Existing storage, handling, contract storage and drayage revenue are not recomputed or duplicated. The old MAIN source export reconciled order-for-order and revenue-for-revenue to the expanded source; three additional MAIN orders in the new export are not adopted into the preserved baseline.

Added orders require both an explicit customer bridge and a recognized warehouse at either endpoint. SUPPRIGA, SUPPRIG1 and SUPPRIG3 map to Savannah, SUPPPAT1 to Houston, and SCMDDETX/SCMDDATX to Dallas. Same-location endpoints count once. Cross-location ambiguity is held for review rather than duplicated. Nonpositive invoice revenue is excluded from the added segments; in particular, the 104 zero-revenue DDRAY moves are billed through 3PL and contribute neither added trucking revenue, load counts nor carrier costs. No extra revenue is synthesized for them.

Dallas is trucking-only in this snapshot. Its warehouse billing fields explicitly show Not loaded, not zero. Warehouse billing remains the existing Savannah/Houston dataset. Rankings are contribution indicators, not audited location profit. Carrier pay on added segments is current-movement override pay, not final settlement.

## Reconciliation

Source coverage, exact revenue/pay controls, baseline equality, excluded orders and source hashes were verified privately against the supplied exports. All original customer/month metrics are unchanged. Raw exports, financial snapshots and order-level audit files are excluded from the repository. The added snapshot is immutable and versioned in public.scm_reporting_snapshots, with RLS enabled and no anon/authenticated grants or policies. Only the server service role can read/insert snapshots, and the report API additionally requires administrator access. Test fixtures use synthetic names and figures.

`scripts/expand-warehouse-trucking.py` rebuilds a private snapshot from a pinned baseline plus fresh order and bridge files and writes a separate audit file with source hashes. Use an output path outside the repository. Always supply the original baseline, not the expanded output as its own baseline.

## Verification and release

Python classifier tests cover aliases, either endpoint, zero revenue, unrelated customers, missing pay, multi-location review, duplicate orders, and unchanged MAIN. React server-render tests exercise the actual report component in All, Savannah, Dallas and Dallas-customer states; data controls verify segment and monthly totals. TypeScript and the production build are required before release.

Reporting files are integrated onto production source 79bf66d rather than deploying the older reporting branch wholesale. Existing operational routes, auth, eCotton delivery and warehouse code are retained. Financial data stays behind withStaffAccess (administrator access on the current production policy); the client imports no raw financial JSON. An additive private snapshot table is required. No McLeod write is performed.

Rollback: restore prior deployment dpl_EaGiDg79KZDT5VyFxTBc633tgTEZ. This change is a read-only report and home-page link, with no operational database changes. Retain the private snapshot table and historical version on application rollback.

## Dallas warehouse billing follow-up

The existing warehouse exports contain LOCAL/HLOCA only; DLOCA cannot be reconstructed from those files. The available contract-storage history contains Dallas entries, but none matches the current 3PL customer/bridge codes. No Dallas contract storage is added on that evidence. The user confirmed DLOCA is the Dallas warehouse-billing source and requested checking contract storage only for real 3PL matches.

`queries/dallas-3pl-billing-export.sql` supplies the missing full-period DLOCA candidate data with order and charge identifiers. It is a single SELECT because the McLeod JDBC tool executed DECLARE statements separately. It intentionally includes all DLOCA customer/order types so mismatched accounts can be reviewed rather than assumed. On import, deduplicate order totals, retain individual charge rows, match the actual 3PL customer bridge, reconcile component totals and leave original MAIN/Savannah/Houston figures unchanged. Until this source is provided, Dallas warehouse billing remains explicitly Not loaded.
