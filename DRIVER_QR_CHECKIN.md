# Driver QR Check-In

Each warehouse has an unguessable public QR link. A driver opens the mobile form, enters the load details, and submits once. The browser captures a fresh high-accuracy GPS position and the server verifies it against the configured gate geofence before creating an inbound check-in row.

## Warehouse workflow

1. Run `supabase/migrations/022_driver_self_checkin.sql` in Supabase.
2. Deploy the application changes.
3. Open `/warehouse/gate` using the warehouse credentials (`WAREHOUSE_USERS`, falling back to `PNL_USERS`).
4. At the gate, choose **Use my current location**, set the allowed radius, activate the site, and save.
5. Print the QR or copy its driver link.

Do not activate a site until its gate coordinates have been confirmed. A radius around 300–800 meters is usually a reasonable starting point, but it should be adjusted for the actual property boundary and phone GPS behavior.

## Driver workflow

The public link is `/gate/check-in/{site-token}`. It works over HTTPS, which mobile browsers require for geolocation. The driver supplies their name, trucking company, mark, customer, BOL B/C, bale count, and equipment. Location access happens when they tap **Verify location & check in**.

An accepted submission creates the same `inbound_checkin_rows` record used by staff, with:

- `draft_status = checked_in`
- no final warehouse location
- the warehouse-local received date and server arrival time
- `checkin_source = driver_qr`
- the GPS accuracy, distance from gate, and verification time for audit

The warehouse grid shows a `QR ✓` marker. Staff assigns the final warehouse location; the existing McLeod processing rules then take over.

## Guardrails

- The public token does not expose the gate coordinates.
- Inactive or unconfigured links return unavailable.
- Location evidence must be less than five minutes old and accurate within 250 meters.
- The server, not the browser, calculates distance and decides whether the driver is inside the geofence.
- Replacing a QR token immediately invalidates older printed signs.
