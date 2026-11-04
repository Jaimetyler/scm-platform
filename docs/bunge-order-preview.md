# Bunge domestic cotton preview

Path: `/bunge-import`, linked from Platform Home. Active admin only. This is an isolated, non-persistent preview: no McLeod create/rating/delivery operation exists in the endpoint. Preview records clear on refresh. Staff POST actions are logged by the existing request guard.

Accepts original Bunge dispatch XLSX/XLS/CSV files up to 3 MB and 250 pickup rows. PDF parsing is deferred until the spreadsheet workflow has been validated. Required headers are Mark, SO, Bales, Warehouse and Load (RTL); an explicit Supply Chain Management carrier section is required. Other/unknown carrier sections are excluded and listed separately. Repeated print headers and address/freight/fuel rows are not loads.

Customer is BUNGOMNE. Grouping is SO + mark, preserving per-pickup source rows, warehouse and RTL date. BLNUM is `MARK TOTAL BALES BALES`. Two pickup stops are supported in the preview; more than two and repeated identical lines are flagged. Unknown/ambiguous location codes remain unresolved. Blank warehouse codes inherit only from a unique explicit code attached to the exact warehouse label in that workbook. No fuzzy name matching is used. Location mapping compares current codes and prev_code. Unverified hours, missing timezones and missing weekday/effective-date schedules remain flagged, not converted into appointments.

Revenue defaults from report destination (DAVIS for Dallas/DeSoto, MAIN otherwise) and can be explicitly selected before upload. Proposed delivery defaults to SAVAGAG2 (Bourne Avenue) for Bunge. An SCM location selector can override it for the whole upload; changing the selection clears the old preview and requires a new preview. The selected location and its current address are verified through a read-only McLeod location lookup. The source destination is shown so differences can be reviewed. Delivery dates and final payload fields still need confirmation before creation is implemented. Freight/fuel detail rows are not summed into rates, since charges can repeat per pickup line.

Available-order checks are explicit read-only actions per proposed order. They search exact BLNUM + Available status + customer BUNGOMNE, hydrate records, and verify identity/status. Failed, capped or nonadvancing searches remain incomplete. This narrow check does not establish the absence of duplicates using changed bale counts or other reference fields; broader SO/reference mapping and a durable import ledger are required before order creation is enabled.

Historical sample validation (never live imports):
- SCM Savannah Dispatch 4070: 40 pickup rows, 35 proposed orders, five two-pickup orders, 3,076 bales. SO 2511158 / mark D1085 becomes D1085 90 BALES (30 at FUNSMOG3, 60 at BCTGMOGA).
- SCM Dallas Dispatch 4629: 141 SCM pickup rows/orders, 12,636 bales; one other-carrier TBA row excluded.
- Unmapped source code 857500 (Dallas Warehouse Company, Grand Prairie) affects four Dallas orders; 570440 (Gaston Cooperative) affects one Savannah order.

Next: user review of these previews, confirm delivery/defaults and reference mappings, resolve the two missing warehouse codes, then implement audited selected-order creation with replay protection and complete duplicate checks. No historical sample should be created in McLeod.
