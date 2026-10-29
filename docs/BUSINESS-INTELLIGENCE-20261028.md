# SCM Business Intelligence

Separate administrator-only routes: `/reporting/business-intelligence` and `/api/reporting/business-intelligence`. Original cotton and warehouse reports remain available. Historical bill-date scope: January 1, 2025–October 20, 2026. The home page links to the combined view.

## Business units and services

Savannah, Houston, Dallas, and Brokerage are business units. A recognized SCM warehouse pickup or delivery assigns trucking to that warehouse unit, regardless of revenue code. With no SCM endpoint, warehouse local revenue codes route to their local warehouse; other moves go to Brokerage. Moves between different SCM warehouses are credited once to the receiving SCM warehouse (the delivery endpoint), including revenue and verified carrier pay, per the user-approved inbound allocation rule. Location mappings remain reviewable.

MAIN, TERRY and DAVIS are OTR. CNTR is direct drayage. DDRAY moves with both endpoints in DFW are Dallas local drayage, including brokered moves; other DDRAY moves remain direct. Other local warehouse drays are local drayage. These remain separate in service, customer, business-unit and monthly views, while both drayage segments contribute once to total trucking revenue.

Handling, storage and other fees are warehouse services. Trucking and chassis billing components on 3PL warehouse invoices are local drayage revenue, with cost unverified. They are not counted as additional transport loads. Unclassified charge residuals remain in Other with a visible review amount; invoice totals are preserved.

## Sources and deduplication

The builder uses the full supplied MAIN/CNTR/DAVIS/DDRAY trucking export and TERRY export for all customers, not only customers connected to warehouse accounts. Cotton local drays come from the completed native order extraction. A GET-only enrichment resolves customer metadata and COTTON classifications for CNTR/TERRY; other cotton flags use the completed native cotton searches. Confirmed miscoded non-cotton accounts remain in the combined report under Non-Cotton.

Company/order IDs deduplicate transport before any sums. Conflicting repeated orders fail the build. The old 3PL and cotton trucking aggregates are never added to the new order ledger. Warehouse invoice components come separately from the reconciled cotton snapshot and the old 3PL warehouse components, controlled against the original header exports (including Dallas). Contract storage from the supplied history is added once after filtering the period and signing credit memos; old report contract-storage aggregates are not imported again. Identical contract source rows are rejected; distinct bills can reuse an invoice number.

Verified customer bridge links merge accounts; names alone never merge customers. The combined customer profile consolidates scopes into one row per unit and includes accounts, service breakdown, monthly activity, and unit comparisons. Whole-row, keyboard, and visible View customer actions open the drilldown. Cotton has the same explicit customer navigation.

## Scope and limits

All business includes Cotton, Non-Cotton, and Unclassified. Contract storage follows the user-confirmed account classification. PERFYAPA, BINDATG1, and KLEN74GA are Non-Cotton; the other accounts on the current contract-storage list are Cotton. New accounts without explicit confirmation remain Unclassified. References identify their warehouse; undated-unit references can use a single explicit warehouse evidenced for the same account, while multiple possible warehouses remain in allocation review.

The initial combined view covers all customers in the supplied trucking revenue-code exports, cotton local drays, and loaded warehouse/contract billing. The remaining non-cotton LOCAL/HLOCA/HLOCAL/DLOCA trucking export has now been loaded. `queries/business-local-trucking-monthly.sql` provides the compact, disjoint export for that scope. these totals are not a certified all-company ledger.

Current-movement override pay is provisional, not audited settlements. Missing cost is unknown, never zero. Transport GP covers verified-pay revenue only. Warehouse operating costs are unavailable. Contribution proxy is warehouse service billing plus known-pay transport GP and excludes the unverified margin on warehouse trucking invoice billing.

## Persistence and verification

Private snapshot `business-intelligence-20261029-v7` resides in the existing RLS-protected snapshot table. Financial JSON, raw exports, customer metadata and audit receipts remain outside the public repository. The API uses the existing staff guard and private/no-store responses. No McLeod writes occur.

Controls reconcile total report revenue to warehouse invoice controls plus distinct transport invoices plus signed contract bills. Monthly customer sums reconcile to overall metrics. Tests cover endpoint-first assignment, receiving-warehouse allocation, zero/missing costs, customer bridges, non-cotton corrections, source deduplication, warehouse/trucking separation, contract credits, and date boundaries. React tests cover scope/unit filters, merged unit rows, customer navigation and protected API structure.

Version 2 imports the supplied local monthly export through `--local-monthly-json`, with unique group keys, count/pay-coverage validation, retained zero-revenue costs, and receipt hashing. It also recognizes verified SCM facility IDs SUPPPOG4 (Savannah), SUPPBATX (Houston), and SUPPGAG3 (Savannah), applying endpoint-first unit assignment to all transport sources. Company totals change only by the additional export; facility mapping changes unit allocation only. Prior snapshots remain available.

October 29: inbound/receiving warehouse allocation now applies to inter-warehouse trucking in both order-level and compact monthly sources. It replaces the allocation-review hold without changing company-wide financial totals or load counts. `inboundAllocatedLoads` records the reassigned count. Unresolved contract references remain separately reviewable.

The DDRAY split now uses verified endpoint cities: both must be in DFW, and these local brokered moves receive Dallas business-unit credit. This service reclassification preserves total trucking revenue, carrier pay, GP and load counts; business-unit credit independently follows the receiving warehouse for SCM-to-SCM moves.

October 29: contract storage for the current account list is fully classified. The confirmed cotton allowlist and three non-cotton exceptions are explicit; classification is not a default for future unknown customers. This changes commodity-scope totals only, preserving every business-unit and company-wide financial measure. The Unclassified filter appears only when applicable.

## Revenue/GP display and chassis disclosure

OTR, local drayage, and direct drayage each show revenue, verified carrier pay, and known-pay order GP together. Customer, unit, and monthly tables pair revenue with the matching service GP. Combined GP and contribution-proxy displays have been removed. GP coverage is explicit when costs are missing; revenue without verified cost is not treated as profit.

Chassis billed is a non-additive, revenue-only invoice subtotal. It remains included in source invoice revenue and must not be added to company revenue a second time. No chassis cost or standalone chassis GP is calculated. Transport order GP still includes all revenue on its underlying orders, including accessorials.

Chassis unit allocation uses revenue codes as requested: LOCAL Savannah; HLOCAL/HLOCA Houston; DLOCA/DLOCAL/DAVIS/DDRAY Dallas; MAIN/TERRY/CNTR Brokerage. Unmapped codes remain reviewable. This allocation is separate from the location-based allocation of transport orders.

Version 5 initially discloses chassis from the supplied Savannah/Houston warehouse charge detail, explicitly marked Partial. Known verified chassis charge codes are 019, SPC, HPC, HSPT and SCS. One HPC description is overridden with a numeric value, so known code matches are included as well as descriptions containing chassis. Signed credits are retained. The compact `queries/business-chassis-billed-monthly.sql` export supports complete charge coverage through `--chassis-monthly-csv`; it replaces the partial source rather than adding to it. Both sources add disclosure metrics only and preserve every existing invoice/transport total. The API's chassisCoverage status is tied to the active snapshot release.

Version 6 loads the complete billed-chassis monthly export, replacing the partial warehouse subtotal. All returned revenue codes map to the configured chassis units, no charge amounts are missing, and chassis remains non-additive with no standalone GP. The complete export excludes voided orders.

Reconciliation exposed voided warehouse orders retained by the older status-less source export. `--warehouse-void-json` supplies GET-only API-verified V records. Matching source header identity and amounts and per-invoice charge components are checked before removing those orders from the combined view. The original warehouse snapshot remains unchanged; only a private copy of its monthly handling/chassis components is adjusted. Unrecognized voided charge classifications fail for review. This source correction changes billed revenue and warehouse invoice counts, while transport load counts, carrier pay, and business-unit allocation rules remain unchanged.

## Month-range filtering

The report exposes From month and Through month inputs with All available and loaded-year shortcuts. These filter bill months, not exact days: the underlying financial snapshot is monthly, and the October 2026 source stops on October 20. Every displayed metric, customer profile, unit comparison, service GP and chassis subtotal is recomputed from the selected monthly rows before other scope/unit/search filters are applied. Original all-period metrics are not reused for filtered views. Empty periods drop from profiles; invalid or out-of-coverage ranges show an error instead of apparent zero financial totals. Inputs and source objects remain unchanged.

Staff management explicitly displays unsupported legacy roles and requires a supported role selection before saving access, preventing an unmatched dropdown value from visually appearing to be Administrator. This UI correction does not grant permissions or change other accounts.

## DFW local drayage revision

Version 7 resolves all 52 DDRAY endpoint locations with GET-only McLeod location records. Both endpoints must be in the DFW metro; DeSoto and Lancaster qualify. Reviewed source cities use the current 11-county metro boundary (https://www.bls.gov/regions/southwest/news-release/areaemployment_dallasfortworth.htm). Unknown locations or new unreviewed cities fail the build. Outside-DFW DDRAY remains direct, CNTR remains direct, and MAIN/TERRY/DAVIS remain OTR. Total company revenue, pay, GP and order counts are preserved; only service and Dallas/Brokerage allocation change. Private endpoint metadata and financial snapshots are never committed.

## Reader methodology guide

`/reporting/business-intelligence/guide` contains the current reader-facing methodology, linked from the report header and footer. It covers dates, service definitions, allocation precedence including DFW DDRAY, GP coverage, chassis, commodity/customer grouping, source controls and review notices. Static explanatory paragraphs move there; the report retains its snapshot cutoff, essential metric labels, and conditional data-quality notices. The guide inherits administrator-only reporting access and supports browser printing. No financial calculation or snapshot changes accompany this presentation update.
