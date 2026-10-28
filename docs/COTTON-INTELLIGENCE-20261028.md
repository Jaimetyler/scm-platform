# Cotton Intelligence

Separate administrator-only financial view at `/reporting/cotton-intelligence`, with the same January 1, 2025–October 20, 2026 bill-date window as Warehouse Intelligence. The existing 3PL report is not changed. A home-page card links to the cotton view.

## Exclusive service categories

1. ECOTTON order type on LOCAL, HLOCAL, HLOCA or DLOCA is combined warehouse handling/storage billing. This classification takes priority over drayage, including orders also marked commodity COTTON.
2. MAIN and DAVIS with commodity COTTON are OTR. TERRY is not part of this cotton scope.
3. Non-ECOTTON cotton on LOCAL, HLOCAL or HLOCA is local drayage; cotton DDRAY is Dallas drayage.

Each company/order contributes to one category only. Voids are excluded. Signed invoice revenue is retained; zero-revenue transport orders remain visible with verified costs, rather than being confused with zero-cost movements. Native Houston data uses HLOCA; both spellings are checked and preserved in source coverage.

## Sources, controls and limits

`scripts/pull-cotton-report.mjs` performs GET-only API reads in bounded, bill-date-sorted pages. It checks source filters, order identity, pagination advancement and date ordering. It stops after crossing the lower date bound. Normalized checkpoints and source files go to an explicitly private directory outside git. The manifest is complete only after every source partition finishes.

`scripts/pull-cotton-customer-links.mjs` resolves only explicit customer bridge targets absent from the order sources. Verified bridge IDs join accounts into customer relationships; unverified or cyclic links leave accounts separate, with a visible coverage note. No name-only customer merging is used.

`scripts/build-cotton-report.py` requires all source partitions, validates the period, deduplicates overlapping local-cotton/eCotton searches, rejects conflicting repeated orders, and uses exact decimal arithmetic. OTR/dray costs come from verified current-movement override pay. Missing pay is retained as unknown; invoice revenue is still included, while the GP measure covers known-pay orders only. Warehouse operating costs are not provided and no warehouse profit is invented.

Combined eCotton invoice revenue is complete independently of charge-line availability. The supplied DLOCA export supports Dallas charge detail after order identity/date/total and per-charge reconciliation. Storage, handling and other fees are shown only when detail coverage is complete in the selected view. Other terminals can be enriched using the single-SELECT `queries/cotton-financial-export.sql`, without counting repeated invoice headers for every charge row.

Local codes map Savannah/Houston/Dallas; DAVIS and DDRAY are assigned Dallas. MAIN uses recognized SCM endpoint IDs and otherwise remains Unassigned in All terminals, so transport revenue is not dropped or assigned to a guessed location. Source account codes and terminal filters remain visible.

The contribution proxy is warehouse invoice revenue plus known-pay OTR and dray GP, not net profit. Separate contract-storage billing outside ECOTTON is not included until cotton allocations are established. No McLeod record, customer bridge or billing configuration is modified.

## Privacy and verification

Financial snapshots are immutable versions in `scm_reporting_snapshots`, with RLS and no client-role grants. The API uses existing staff authorization and private/no-store responses. No financial JSON is imported by the client or stored in the public source repository. Tests use synthetic accounts and amounts.

Classification tests cover commodity/revenue/type precedence, voids, duplicate source partitions, customer bridges, unknown carrier pay, explicit zero pay, unassigned MAIN and validated warehouse charge detail. React server-render tests cover overall/customer/terminal/search behavior, pending detail and protected API structure. Native MAIN/DAVIS/DDRAY candidate orders were independently compared to the supplied full-period trucking CSV for identity and financial amounts.

The snapshot identifier for this first view is `cotton-intelligence-20261028-v3`. No schema migration is needed. On rollback, restore the previous app deployment and retain private snapshot history.

Confirmed non-cotton account KLEN74GA is excluded from the cotton snapshot even when its source commodity says COTTON. This reporting correction leaves McLeod records unchanged and records excluded counts in the build audit. The prior snapshot is retained.

Additional confirmed non-cotton exclusions: CKTRCHIL, RSMCCHNC, EVANONCA, HAMPPOOR and HOBBOKOK. These exact account exclusions apply to future snapshot builds as well as the current correction.
