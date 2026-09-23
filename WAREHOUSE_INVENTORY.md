# Warehouse inventory

Apply `supabase/migrations/021_warehouse_inventory.sql` before deploying the
inventory pages. The migration creates current inventory lots, an append-only
inventory event ledger, summary/update functions, and a check-in synchronization
trigger. It also backfills inventory from existing check-ins whose status is
`processed` or `outside_carrier`.

## Inventory source

Each completed check-in creates one inventory lot, even when another receipt has
the same mark. `source_checkin_id` prevents retries or repeated synchronization
from creating duplicate lots. Corrections to a completed check-in update its
linked lot and preserve staff-entered inventory notes. The original and corrected
values are recorded in `warehouse_inventory_events`.

The check-in bale count initializes both original and current bales. Available
bales are current bales minus allocated bales. Staff may edit the current count,
allocated count, missing count, location, booking number, status, and notes from
the inventory page. Updates use `updated_at` as an optimistic concurrency guard
and create a ledger event.

## Pages

- `/warehouse/inventory` selects a configured warehouse site.
- `/warehouse/inventory/[terminal]/[siteCode]` shows the site inventory.
- The home page and each check-in page link to inventory.

Inventory is always queried and updated with both terminal and site code. The
page includes search, status filters, summary totals, 100-row pagination, and an
expanded edit form that keeps the normal table compact.

## E-Cotton preparation

Completed check-ins with a warehouse location start with E-Cotton receipt status
`pending`; rows without a location start as `not_ready`. This release displays
that status but does not transmit anything to E-Cotton. Later receipt processing
must update the status and store the provider response without changing McLeod
processing state.

## Future bookings and breaks

The ledger supports future `break`, `shipment`, location, allocation, and
adjustment events. Booking number and allocated quantity are editable now; the
booking-management release will add booking records and multi-booking allocation
details without changing the source check-in relationship.
