# Completed McLeod orders in check-in lookup

Staff cotton, staff lumber/other, and driver QR lookup results retain completed
orders instead of hiding them as missing matches. Completed matches are read-only:

- A departure on the relevant pickup stop says **Pickup already completed in McLeod**.
- A departure on the relevant delivery stop says **Delivery already completed in McLeod**.
- A delivered/completed/closed order status without a stop departure says
  **Order already closed out in McLeod**. No completion time is invented.
- Cancelled orders have a separate cancellation message.
- Results show the order number, stop location/address supplied by McLeod,
  trucking company (or an explicit unavailable label), and recorded departure time.

Completed results remain visible even outside the active 45-day matching window,
subject to the existing search result limits and the records returned by McLeod.
They cannot be chosen or automatically linked. If all matches are closed, new
check-in is disabled until the reference is corrected. Active results can still
be selected when a search also returns historical loads.

Carrier attribution first uses the stop's movement ID or its presence in a
movement's stop list. A single movement is used when no explicit linkage exists.
Ambiguous multi-movement orders do not fall back to the current movement's carrier.
If only order-level carrier information exists, it is shown as the trucking company.
Missing carrier names may be resolved through the existing carriers/vendors APIs;
an enrichment failure never hides the completed result.

New linked check-ins and attaching an order to an existing domestic row re-check
completion server-side. The existing cotton eligibility and duplicate protections
remain in place. This does not globally prohibit a reused reference/mark from
being recorded as a different, unlinked load.

No database migration is required. This change does not relocate McLeod stops.

## Validation

Run on Node 22.18+ or Node 24 with the project's dependencies installed:

```bash
node tests/checkin-completion.test.mjs &&
node tests/checkin-completion-routes.test.mjs &&
node tests/checkin-mcleod-order-id.test.mjs &&
node tests/checkin-search-response.test.mjs &&
npm run build
```

The added tests cover completion labels, historical carrier selection, carrier
enrichment failures, old completed loads, both BL tokens in `2168418 / 1479334`,
staff/driver API responses, save-time rejection, and safe rendering. HTTP and
database boundaries are mocked; they do not access the live McLeod account.

Manual checks after deployment:

1. At Houston 5300, search a known delivered cotton mark. Verify the completed
   notice, carrier, and departure time against McLeod. The result is not selectable.
2. Search an active cotton mark. Verify that normal check-in still works.
3. Search a completed lumber pickup through staff lookup and driver QR lookup
   while physically at that QR code's yard. Confirm that it says pickup completed.
4. Search a reference shared by active and completed orders. Select only the
   active order; historical results must never auto-fill a new arrival.

## Separate pending lookup changes

- The Savannah 1601 “unexpected search response” requires the real response-shape
  diagnostic before changing the parser. The fixture tests do not establish that
  the live search succeeds there.
- Cross-yard discovery and an explicit “Found at another location” workflow remain
  separate work. Existing yard filtering is retained in this patch.
- Reference field matching currently drives pickup/delivery selection in some
  lookup paths; allowing either reference field for either direction remains pending.
