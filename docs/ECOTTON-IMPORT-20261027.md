# eCotton import: Houston pilot and terminal profiles

Status: implementation and synthetic execution tests complete; staging-only ledger installed. Production deployment and real McLeod creation/rating are NOT authorized by the earlier Dallas billing deployment approval.

## Accounting flow

Open `/ecotton-import` as an active administrator. Choose the warehouse, upload the untouched Billing Summary and Billing Report Detail CSVs, and check reports/duplicates. No column shifting or manually added customer IDs is required. The preview persists each order and expected total. Review customer IDs, reference, mark, invoice date, location, and charge lines. Repeat uploads reopen the durable ledger. The creation/rating button is disabled unless both `ECOTTON_IMPORT_WRITES_ENABLED=true` and `MCLEOD_SYNC_ENABLED=true`. Delivery is never performed by this feature.

Mark becomes consignee reference; Shipping Order # becomes BOL; each order's own invoice total becomes its planning comment. The report-wide total is used only for reconciliation. Customer aliases are the exact mapping provided by operations, normalized for case and whitespace, without fuzzy matching. Unknown customers and charge mappings block the preview. Repeated charge lines are preserved, including multiple storage lines with different rates. Calculations use integer cents; all per-order subtotals and both report grand totals must agree.

## Profiles and evidence

- Houston: HOUWHSE / HLOCA. User supplied desktop import mapping, original reports and completed sheet. Read-only prior order 0825685 (BOL 52828) confirmed customer BUNGECNE, mark T0033, planning comment 642, collection method T, date-only values with McLeod's Eastern offset, and the movement fields.
- Dallas: SCMDDETX or SCMDDATX / DLOCA. Report IDs 875260 and 843001 select/check the proper warehouse. Existing orders 0718302 and 0827937 independently confirmed the creation defaults and payee fields at both locations.
- Savannah: SAVWHSE or SUPPRIG2 / LOCAL, chosen explicitly. Existing ECOTTON orders 0827812, 0827813, 0827814 confirm these distinct locations. Existing terminal_defaults lists SAVWHSE; it must not silently substitute for SUPPRIG2. No untouched Savannah report was supplied in this task; production acceptance of its report layout and warehouse choice remains required.
- Common defaults: ECOTTON order type and ordered_by; COTTON commodity; C equipment; T mode/collection; F rate type, 1 unit, zero linehaul; movement payee SCMIRIGA with F/1/0 payment settings. `override_paye_rate` is the spelling returned by live McLeod, not override_payee_rate.
- New orders and stops are explicitly Available (A), not Delivered. Invoice dates use the McLeod Eastern midnight convention verified in the existing desktop import, including DST, rather than the browser/server machine timezone. This is separate from physical warehouse arrival/departure timestamps.

## Duplicate and uncertain-write safeguards

A fresh complete bounded McLeod search uses reference + ECOTTON + terminal revenue, then checks both stop locations. Unknown response shapes, incomplete pagination, invalid IDs and vendor errors block creation. McLeod's documented/live-confirmed top-level JSON null means a successful no-match response; arbitrary unknown objects do not.

The durable ledger uniquely owns terminal + warehouse + shipping reference across every upload/run. Different source content for an owned reference becomes a source conflict; legitimate reference reuse requires explicit review rather than automatic overwriting. Duplicate lookup compares customer, mark and invoice date. Existing fully matching/rated orders are read-back verified and skipped; existing differing orders are blocked, never silently modified.

Database compare-and-set version transitions atomically claim a row. Every transition appends actor/state/order-ID/note/time audit evidence in the same transaction. Two submissions cannot both create the same platform-owned reference. Creation receipts are persisted before rating. Any uncertain create response, missing returned ID, database receipt failure, autorate timeout or failed post-write verification leaves a fence. No expired-claim takeover, blind resend, or automatic create retry exists. In-flight claims cannot be reconciled for five minutes; reconciliation performs only GETs and never turns a no-match into permission to retry a write. Preview-only failures have a separate read-only recheck path.

McLeod itself does not provide a cross-system unique constraint here: a person simultaneously creating the same load in the desktop importer can race the API search/create window. Stop parallel manual imports for the pilot batch.

## Verification performed

- Actual private Houston CSVs: 29 orders, 197 charges, $24,377.68; all 29 per-order detail totals agree with summary and report totals. ECOMDAT1 = 8, BUNGECNE = 15, EDFMECTX = 6.
- Real read-only McLeod lookup of all 29 references: complete no-match results at HOUWHSE/HLOCA/ECOTTON. No McLeod writes made.
- Shared parser/payload fixtures for Houston, both Dallas warehouses and both Savannah warehouse profiles.
- Engine fixtures cover successful create/rate/read-back, existing-order skip, two simultaneous requests, vendor timeout, missing creation ID, database receipt failure, autorate uncertainty, immutable fences, extra/missing charge lines and read-only reconciliation. Vendor writes are simulated; this does not certify real create/autorate compatibility.
- Actual PostgreSQL-compatible migration tests cover repeated import digests, source conflicts across different runs, atomic CAS claims, illegal transitions, private table/function permissions and append-only audit grants.
- Route tests verify independent write flags, saved-run row membership, explicit confirmation and five-minute in-flight reconciliation guard. Existing staff guard restricts new operational paths to administrators and enforces request origin.
- Full local suite: 408 passing; TypeScript passes.
- Staging RLS verification: all four ledger tables have RLS enabled; anon/authenticated have no SELECT. Functions have fixed search_path, SECURITY INVOKER and service_role-only EXECUTE. Security advisor changes consist only of four expected INFO notices for RLS without public policies; no new WARN findings. Existing 15 mutable-function warnings and leaked-password-protection warning predate this change.

## Staging configuration

Migration `20261027190536_ecotton_import_ledger.sql` was applied only to project vlfqgrnmafntrnhhhzcc. Copied active Houston mapping configuration: 18 descriptions and 9 distinct tariffs. No operational production rows were copied. Billing reads use the existing branch-scoped real McLeod read configuration; warehouse fixture and disabled sync remain unchanged. Keep ECOTTON_IMPORT_WRITES_ENABLED unset/false. No emails sent or user passwords changed.

## Production rollout — requires explicit approval

1. Pause concurrent desktop imports for the 29-order Houston batch. Capture a fresh logical database backup and its checksum; retain the existing operational rollback baseline. The historical October 27 backup predates this feature and is not a fresh release backup.
2. Recheck source SHA, successful CI and staging build. Apply only the additive eCotton ledger migration to production iurnpebmdfbjttejlymr; do not rerun earlier warehouse migrations. Verify RLS, service-only grants, and RPC execution permissions.
3. Deploy the exact reviewed commit with ECOTTON_IMPORT_WRITES_ENABLED=false. Verify both production aliases and `/ecotton-import` authentication, upload parsing, real duplicate search and totals. The existing production Houston mappings were read-only verified; no production mapping changes are required by this release.
4. Obtain explicit approval for a real pilot: Houston BOL 52795 / mark TZH34 / customer ECOMDAT1 / invoice 2026-10-20 / $911.40. Recheck duplicates immediately before creating. Enable ECOTTON_IMPORT_WRITES_ENABLED for the approved release, keep MCLEOD_SYNC_ENABLED true, and process only that saved row. The UI exposes per-row ledger state; no delivery operation exists.
5. Verify returned McLeod ID, customer, both HOUWHSE stops, dates, planning comment 911.40, all charge lines, zero linehaul, zero movement pay, and final total 911.40. Obtain batch approval before processing the remaining 28. Stop on any uncertainty and reconcile read-only before considering further writes.
6. Accept actual untouched Dallas and Savannah report samples and verify warehouse selection before using their creation profiles operationally. Delivery automation remains out of scope for this release.

## Rollback

Disable ECOTTON_IMPORT_WRITES_ENABLED and redeploy, then restore the prior production deployment 2b1af0b / dpl_6WACjEuf1br9HkxvBLgRANnefSz1 (or the recorded immediately preceding deployment). Retain the new tables, run snapshots, assigned McLeod IDs and audit events. Never restore a stale database backup over current warehouse records. App rollback cannot undo created McLeod orders; reconcile them manually. Never delete an uncertain ledger row to permit a retry.
