# Driver QR Check-In

Each warehouse has an unguessable public QR link. A driver opens the mobile form, identifies a pickup or delivery and its material, and submits once. The browser captures a fresh high-accuracy GPS position and the server verifies it against the configured gate geofence before creating a check-in row.

## Warehouse workflow

1. Run `supabase/migrations/022_driver_self_checkin.sql`, then `supabase/migrations/023_driver_bol_photos.sql` in Supabase.
2. Deploy the application changes.
3. Open `/warehouse/gate` using the warehouse credentials (`WAREHOUSE_USERS`, falling back to `PNL_USERS`).
4. At the gate, choose **Use my current location**, set the allowed radius, activate the site, and save.
5. Print the QR or copy its driver link.

Do not activate a site until its gate coordinates have been confirmed. A radius around 300–800 meters is usually a reasonable starting point, but it should be adjusted for the actual property boundary and phone GPS behavior.

## Driver workflow

The public link is `/gate/check-in/{site-token}`. It works over HTTPS, which mobile browsers require for geolocation. At every yard, the driver supplies their name, mobile number, pickup/delivery direction, material type (Cotton, Lumber, or Other/FAK), and a reference number. Pickups also require a destination. Cotton adds mark and the bale count shown on the BOL. The driver may attach an optional paperwork photo. Location access happens when they tap **Verify location & check in**.

An accepted submission creates the same `inbound_checkin_rows` record used by staff, with:

- `draft_status = checked_in`
- no final warehouse location
- the warehouse-local received date and server arrival time
- `checkin_source = driver_qr`
- the GPS accuracy, distance from gate, and verification time for audit
- movement direction, material, reference number, and pickup destination when applicable
- an optional paperwork image stored in the private `driver-bol-documents` bucket

For cotton, the driver's bale count populates **BOL B/C**. Customer, actual unloaded bales, equipment, and warehouse location remain blank for staff to complete. The warehouse grid shows a `QR ✓` link to an authenticated details page with the driver's phone and location-verification summary. When present, it also shows an authenticated paperwork link.

Only **Cotton + Delivery** is eligible for the existing McLeod delivery workflow. Cotton pickups and every Lumber/Other movement are labeled **Gate only** and cannot accidentally post a McLeod delivery. Their future operational completion workflow can be added without changing the driver QR form.

## Guardrails

- The public token does not expose the gate coordinates.
- Inactive or unconfigured links return unavailable.
- Location evidence must be less than five minutes old and accurate within 250 meters.
- The server, not the browser, calculates distance and decides whether the driver is inside the geofence.
- Replacing a QR token immediately invalidates older printed signs.
