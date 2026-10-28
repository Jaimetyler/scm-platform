# Warehouse Intelligence: connected trucking and Dallas billing

## Scope and behavior

The historical report at `/reporting/warehouse-intelligence` adds separate MAIN, CNTR, DAVIS and DDRAY segments, rolled into connected trucking loads, invoice revenue, carrier pay, provisional gross profit and margin. Location/customer selection, search, ranking and monthly trends use the combined trucking metrics. The home page links to the administrator-protected report.

All existing MAIN and Savannah/Houston warehouse customer/month metrics are preserved from reporting source 328bf7e. MAIN source orders and revenue were reconciled to the fresh export; newly appearing MAIN records are not substituted into the preserved baseline. Added trucking requires an explicit 3PL customer bridge and a recognized SCM warehouse at either endpoint. SUPPRIGA/SUPPRIG1/SUPPRIG3 are Savannah; SUPPPAT1 is Houston; SCMDDETX/SCMDDATX are Dallas. Orders touching the same location twice count once. Cross-location ambiguity is held for review. Nonpositive invoice revenue is excluded from added trucking, so drays billed through 3PL are not added again or charged carrier costs in the connected trucking indicator.

## Dallas warehouse billing

Dallas DLOCA billing uses only order type 3PL. ECOTTON is explicitly excluded from both the Dallas merge and added trucking classifier; cotton reporting remains separate. Repeated order headers are verified and counted once, while charge rows use unique company/charge IDs. Each order reconciles total invoice revenue to freight plus its charges. D3OH is handling, D3OS is storage, and C3 pre-pull fees are other accessorials. Unknown charge codes or mismatched totals stop the build.

The original bridge file omitted many Dallas accounts. Exact McLeod customer reads supplied names and bridge_id for all Dallas 3PL source customers. Previously known links were checked for differences and preserved. Existing customer names are reused by warehouse account code to maintain location grouping. Contract storage is included only when its Dallas reference, period and customer bridge actually match. Credit memos reduce revenue even when the export presents a positive amount. Matching invoice/credit/rebill records are not blindly deduplicated by invoice number. Dallas coverage is marked loaded only after the complete DLOCA export reconciles; known no-activity accounts show zero.

The recovered links revealed one trucking code shared by different warehouse accounts. Those billable moves are counted once in a separately labeled Shared trucking relationship, with its account codes and allocation note visible. They are not arbitrarily assigned to either customer's profitability. All existing MAIN attribution is unchanged. Shared account allocation still requires operational review; source code/bridge values are not rewritten in McLeod.

## Financial definitions and privacy

The contribution indicator is warehouse storage, contract storage and handling revenue plus connected trucking GP, not audited net profit. Added carrier pay is current-movement override pay, not final settlement. Warehouse operating costs and costs on excluded zero-revenue drays are outside that indicator. Original warehouse drayage revenue is not added a second time as trucking revenue.

Raw exports, order-level audits and financial snapshots stay outside the public source repository. Private, immutable snapshots are stored in `scm_reporting_snapshots`, with RLS enabled and no PUBLIC/anon/authenticated grants or policies. Only the service role can read/insert them, and the read-only API additionally uses existing administrator authorization and private/no-store responses. The client imports no financial JSON. Tests use synthetic figures and identities. No McLeod writes or operational record changes are performed.

## Rebuild and verification

1. `scripts/expand-warehouse-trucking.py` reads a pinned original baseline, fresh trucking CSV and verified bridge CSV (encoding is explicit), writing a private snapshot and source-hash/order audit outside the repository.
2. `scripts/add-dallas-warehouse-billing.py` merges the full DLOCA export, verified Dallas customer names/bridge IDs and contract history into a new private snapshot. It validates per-order components, duplicate keys, source scope, credit signs and customer matching.
3. Verify every original MAIN/warehouse metric and month unchanged, each segment's monthly/customer/aggregate controls, no ECOTTON inclusion, no duplicate connected orders, and all DLOCA invoices reconciled.
4. Python classifier/merge tests cover aliases, shared bridges, excluded ECOTTON and zero revenue, missing pay, duplicate charges, credit/rebill signs, and unchanged MAIN. React server-render tests exercise the actual component with All, Savannah, Dallas and customer filters. Run TypeScript, existing regression suite and production build before release.

The deployed source is based on production 79bf66d, retaining the current warehouse, eCotton delivery and authentication code rather than deploying the older reporting branch wholesale. A versioned private snapshot migration is additive. Rollback to deployment dpl_EaGiDg79KZDT5VyFxTBc633tgTEZ if necessary, retaining snapshot history.
