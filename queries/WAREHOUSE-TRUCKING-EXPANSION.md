# Warehouse-connected trucking expansion

Confirmed October 28, 2026: retain the current warehouse/customer scope. Add CNTR brokered direct drays, DAVIS trucking, and DDRAY trucking to the existing MAIN connection. Do not include unrelated loads solely because their revenue code is eligible.

The existing report is a historical snapshot at `/reporting/warehouse-intelligence`, with code under `app/reporting/warehouse-intelligence/` and snapshot data in `lib/reporting/warehouse-intelligence-data.json`. The current location filters are Savannah and Houston. Adding DAVIS/DDRAY does not itself authorize attributing all of their loads to a Dallas warehouse or introducing unrelated Dallas customers.

## Source gap and next step

The saved `orts orders.csv` has only `order_id,customer_code,bill_date,otr_revenue`. It does not expose revenue code or warehouse endpoints, so the missing CNTR/DAVIS/DDRAY population cannot be inferred from that file. Existing customer bridge and carrier-pay exports support the old MAIN report; they are not evidence of coverage for the new codes.

Run `warehouse-connected-trucking-export.sql` in McLeod reporting and export the full result with headers. It is SELECT-only against business data and keeps the established Jan 1, 2025–Oct 20, 2026 period. It includes all four codes as candidates; final inclusion still uses customer bridge and location checks. MAIN is exported as a control for reconciliation, not an instruction to replace its calculations.

Before producing new totals:

1. Verify one row per company/order, date coverage and totals by revenue code.
2. Reconcile the MAIN control against the existing snapshot and source exports. Resolve any difference before changing existing calculations.
3. Match eligible trucking customers through the existing warehouse customer bridge and verify endpoint locations. List unmatched or ambiguous customer/location matches for review; do not allocate the same order to both locations or guess from revenue code.
4. Verify carrier-pay coverage and whether multiple movements require additional pay rows. The extraction exposes current movement override pay only; do not present it as final settlement or silently replace missing pay with zero.
5. Show MAIN, CNTR, DAVIS and DDRAY separately with loads, revenue, carrier pay and provisional GP, then roll up warehouse-connected trucking without duplicating warehouse drayage revenue.
6. Keep MAIN/OTR labels specific to MAIN. Use connected trucking for a total that also contains direct drays.

No report data or production behavior was changed in this preparation step. A new export is required to populate and reconcile the added segments.
