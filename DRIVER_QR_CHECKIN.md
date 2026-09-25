# Driver QR Check-In

Each warehouse has one unguessable public QR link. A driver first chooses **Container / Drayage** or **Domestic Freight**. The browser captures a fresh high-accuracy GPS position and the server verifies it against the configured gate geofence before accepting either type of arrival.

## Warehouse workflow

1. Run migrations `022` through `026` in numeric order in Supabase, including `025_container_queue_device_lock.sql` and `026_domestic_gate_queue.sql`.
2. Deploy the application changes.
3. Open `/warehouse/gate` using the warehouse credentials (`WAREHOUSE_USERS`, falling back to `PNL_USERS`).
4. At the gate, choose **Use my current location**, set the allowed radius, activate the site, and save.
5. Print the QR or copy its driver link.

Do not activate a site until its gate coordinates have been confirmed. A radius around 300–800 meters is usually a reasonable starting point, but it should be adjusted for the actual property boundary and phone GPS behavior.

## Driver workflow

The public link is `/gate/check-in/{site-token}`. It works over HTTPS, which mobile browsers require for geolocation.

**Container / Drayage** asks only for the driver's name. After GPS verification, the server records the arrival time and returns the driver's current number in line. Warehouse staff use `/warehouse/gate/{terminal}/{site-code}/containers` to see the oldest arrival first and mark drivers complete or remove them. Container arrivals live in `container_gate_queue`; they do not enter the domestic grid or McLeod.

The browser receives an anonymous device ID that is stored locally and hashed before it is saved. A device may hold only one waiting container entry across SCM yards. Scanning again returns the existing driver's current position instead of creating another entry. Completing or removing that entry releases the device for its next check-in. This discourages proxy check-ins without requiring an account or SMS, but clearing browser storage can bypass it; stronger identity verification remains a future option if needed.

**Domestic Freight** asks for the driver's name, mobile number, pickup/delivery direction, material type (Cotton, Lumber, or Other/FAK), and a reference number. Pickups also require a destination. Cotton adds mark and the bale count shown on the BOL. The driver may attach an optional paperwork photo. Location access happens when they tap **Verify location & check in**.

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

The warehouse check-in has **Cotton** and **Lumber & Other** views. Cotton keeps the existing grid and McLeod delivery workflow. `/warehouse/gate/{terminal}/{site-code}/domestic` shows Lumber and Other QR arrivals, with active trucks in arrival order and recent completed check-ins below. The independent yard status progresses through **Waiting → Called → In door → Loading/Unloading → Complete**. Staff can move one stage back to correct a tap, or remove an arrival. Each transition records server time and the warehouse user; completion removes it from the active queue. The McLeod processing status remains independent. Older QR check-ins are marked completed during migration so they do not appear as waiting trucks.

The Lumber & Other view uses a spreadsheet layout. Pickup references are searched within McLeod `orders.blnum`; delivery references are searched within `orders.consignee_refno`. Staff choose among returned orders if there is more than one possible match. The chosen order ID and its customer are recorded on the check-in; the lookup does not alter the McLeod order. For warehouse-only freight, staff can type a customer without a McLeod order. Editing a reference clears a previously selected McLeod order and its customer so the new reference can be checked again. The customer list is not drawn from the cotton cross-reference.

Staff can also fill in a blank Lumber & Other spreadsheet row without a driver QR arrival. Choose pickup/delivery and material, enter the reference, and save the row; customer, driver, destination, location, and notes can be entered at the same time. After saving, the row joins the yard queue and can use the same McLeod order lookup. The **+ 5 Blank Lines** button adds more entry rows. These manual rows stay outside the cotton McLeod delivery posting workflow.

## Guardrails

- The public token does not expose the gate coordinates.
- Inactive or unconfigured links return unavailable.
- Location evidence must be less than five minutes old and accurate within 250 meters.
- The server, not the browser, calculates distance and decides whether the driver is inside the geofence.
- Replacing a QR token immediately invalidates older printed signs.
