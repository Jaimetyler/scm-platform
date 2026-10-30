# Shared warehouse navigation

The warehouse screens now share a top bar with Overview, Check-ins, Inventory / Marks, Outbound bookings, and History. `/warehouse` is the new overview. Existing operational URLs remain valid.

The platform home page has four launch cards: Profit & Loss, Warehouse, Late Fees, and Billing Upload. One Warehouse card opens `/warehouse`; the warehouse navigation and location selector appear only after entering the warehouse area. The dashboard retains Savannah/Houston switching and the last selected location. Check-ins process directly into McLeod. The historical cotton processing report remains accessible under History.

## Location and navigation

- Terminal and warehouse buttons stay available on warehouse screens and booking details. Site-specific URLs take priority over remembered preferences.
- Location and the last check-in tab are remembered in local storage. A link with an explicit location overrides that memory; "All sites" remains scoped to its terminal.
- Cotton, Domestic Line, Lumber & Other, and Containers appear under Check-ins according to the configured site's capabilities. Savannah 1601 never opens a cotton sheet or cotton inventory through navigation.
- Opening a booking from a filtered list retains that exact list scope and filters in its return link, including when the list covered all sites. Selecting a different location from booking details opens the booking list at that location, not the same booking ID at a different warehouse.
- Outbound location cards are replaced by the common location buttons. Booking cards and date/customer/vessel filters remain.
- All-sites check-in, inventory, and history views are site launchers in this first pass. They do not combine operational grids or allow entries without a warehouse.
- Driver QR setup remains reachable in the utility links and lists all configured sites. The retired check-in Excel upload is no longer linked; /inbound redirects to the live check-in sheets. The legacy cotton processing report retains its own terminal/date filters, explicitly labeled beneath the navigation.
- Driver-detail pages derive their location from the retrieved record. Public driver QR pages and booking print pages do not display the staff navigation.

## Remembered page state

Outbound dashboard filters remain in the URL and local storage. Inventory searches/status/page, domestic history filters/page, cotton Today/Earlier selection, booking mark search, and legacy cotton history filters are restored per page from session storage. Scroll position is restored as asynchronous content becomes available, stopping if the user interacts with the page.

Only view preferences are stored by this change. It does not cache fetched rows, driver details, or unsaved operational edits. Existing save and autosave behavior still applies. If browser storage is unavailable, routes and forms continue to work, but preferences may not survive a reload.

## Validation

- `node --test tests/warehouse-navigation.test.mjs tests/outbound-dashboard.test.mjs`: 11 passing checks for routes, site capabilities, terminal scoping, booking return URLs, filters, and the existing deadline rules.
- TypeScript check passed.
- Production build passed with placeholder Supabase environment values for build-time module initialization; no production service calls were used for verification.
- A local React/JSDOM interaction harness exercised terminal/site changes, filtering and returning from a booking, switching between check-ins and outbound, inventory/history filter restoration, remembered location, staff-navigation exclusion on public/print routes.
- A full browser/layout check and live-service check were not performed in this environment. Check these screens in the normal browser before deploying.

No SQL migration, API contract change, or new package dependency is required.

## Booking import panel

Import opens directly beneath the page title, above the booking filters. All-sites and non-cotton views show explicit cotton warehouse buttons before file selection. The chosen warehouse becomes the workspace location. The panel contains file selection, progress/errors, and date review. Closing it hides the whole import flow. Requests are cancelled on location change or leaving the page; late responses cannot populate another warehouse. A 60-second timeout ends a stuck request with a readable message, including a possible-save warning if saving timed out.

Import follow-up validation: production build and TypeScript passed; 9 existing booking parser/date tests passed. React/JSDOM checked import opening, warehouse selection, multipart fields, date confirmation, file/service errors, and cancellation on warehouse changes. A real local HTTP request with a generated Bunge-format XLSX returned the expected preview; Savannah 1601 was rejected. The legacy route returns the framework redirect to live check-ins. No production booking was created during these checks.
