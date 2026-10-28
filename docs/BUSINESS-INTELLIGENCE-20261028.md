# SCM Business Intelligence

Separate administrator-only routes: `/reporting/business-intelligence` and `/api/reporting/business-intelligence`. Original cotton and warehouse reports remain available. Historical bill-date scope: January 1, 2025–October 20, 2026. The home page links to the combined view.

## Business units and services

Savannah, Houston, Dallas, and Brokerage are business units. A recognized SCM warehouse pickup or delivery assigns trucking to that warehouse unit, regardless of revenue code. With no SCM endpoint, warehouse local revenue codes route to their local warehouse; other moves go to Brokerage. Moves between two different SCM warehouses remain in Allocation review, counted once in overall totals and outside the four unit totals until a policy is chosen. Location mappings remain reviewable.

MAIN, TERRY and DAVIS are OTR. CNTR and DDRAY are direct drayage. Local warehouse drays are local drayage. These remain separate in service, customer, business-unit and monthly views, while both drayage segments contribute once to total trucking revenue.

Handling, storage and other fees are warehouse services. Trucking and chassis billing components on 3PL warehouse invoices are local drayage revenue, with cost unverified. They are not counted as additional transport loads. Unclassified charge residuals remain in Other with a visible review amount; invoice totals are preserved.

## Sources and deduplication

The builder uses the full supplied MAIN/CNTR/DAVIS/DDRAY trucking export and TERRY export for all customers, not only customers connected to warehouse accounts. Cotton local drays come from the completed native order extraction. A GET-only enrichment resolves customer metadata and COTTON classifications for CNTR/TERRY; other cotton flags use the completed native cotton searches. Confirmed miscoded non-cotton accounts remain in the combined report under Non-Cotton.

Company/order IDs deduplicate transport before any sums. Conflicting repeated orders fail the build. The old 3PL and cotton trucking aggregates are never added to the new order ledger. Warehouse invoice components come separately from the reconciled cotton snapshot and the old 3PL warehouse components, controlled against the original header exports (including Dallas). Contract storage from the supplied history is added once after filtering the period and signing credit memos; old report contract-storage aggregates are not imported again. Identical contract source rows are rejected; distinct bills can reuse an invoice number.

Verified customer bridge links merge accounts; names alone never merge customers. The combined customer profile consolidates scopes into one row per unit and includes accounts, service breakdown, monthly activity, and unit comparisons. Whole-row, keyboard, and visible View customer actions open the drilldown. Cotton has the same explicit customer navigation.

## Scope and limits

All business includes Cotton, Non-Cotton, and Unclassified. Contract invoices have no commodity allocation, so they appear in All/Unclassified rather than being guessed into Cotton or Non-Cotton. References identify their warehouse; undated-unit references can use a single explicit warehouse evidenced for the same account, while multiple possible warehouses remain in allocation review.

The initial combined view covers all customers in the supplied trucking revenue-code exports, cotton local drays, and loaded warehouse/contract billing. Remaining non-cotton LOCAL/HLOCA/HLOCAL/DLOCA trucking is not yet loaded. `queries/business-local-trucking-monthly.sql` provides a compact, disjoint export for that remaining scope. The UI states this limitation; these totals are not a certified all-company ledger.

Current-movement override pay is provisional, not audited settlements. Missing cost is unknown, never zero. Transport GP covers verified-pay revenue only. Warehouse operating costs are unavailable. Contribution proxy is warehouse service billing plus known-pay transport GP and excludes the unverified margin on warehouse trucking invoice billing.

## Persistence and verification

Private snapshot `business-intelligence-20261028-v1` resides in the existing RLS-protected snapshot table. Financial JSON, raw exports, customer metadata and audit receipts remain outside the public repository. The API uses the existing staff guard and private/no-store responses. No McLeod writes occur.

Controls reconcile total report revenue to warehouse invoice controls plus distinct transport invoices plus signed contract bills. Monthly customer sums reconcile to overall metrics. Tests cover endpoint-first assignment, inter-warehouse review, zero/missing costs, customer bridges, non-cotton corrections, source deduplication, warehouse/trucking separation, contract credits, and date boundaries. React tests cover scope/unit filters, merged unit rows, customer navigation and protected API structure.
