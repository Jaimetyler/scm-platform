# Houston staff pilot

This replaces shared Basic Auth with individual Supabase Auth accounts. This update is based on main commit `78b54cf` and includes today’s booking cleanup integration. Apply scm-user-invitations.patch; do not reapply the old Houston users or cotton patch.

## Access

| Role | Warehouse visibility | Operational writes | Other access |
| --- | --- | --- | --- |
| Administrator | All terminals | All terminals | Users, QR/geofence settings, P&L, billing, imports |
| Warehouse operator / Houston | Assigned terminal only | Houston 5300 and 4331 | No staff administration or financial modules |
| Dispatcher / viewer | Both terminals | None | No staff administration or financial modules |

Operators land in their assigned terminal and can read and update only that terminal. Dispatch/viewer accounts retain read-only access to both terminals. URL edits and direct API requests cannot bypass the operator terminal restriction. This does not itself implement the separate McLeod cross-yard search/modal feature discussed earlier. The existing McLeod search matching behavior remains as it was.

All internal API handlers authenticate and authorize on the server. Record-ID writes resolve the saved terminal, so changing the request's terminal cannot grant access to another terminal's record. Operator cotton delivery sync also verifies the actual McLeod delivery stop belongs to the selected warehouse. Spreadsheet processing remains administrator-only. Existing driver QR routes remain public with their existing token, location and validation checks; staff roles do not replace those controls.

Roles live in the server-only `scm_staff` table, never editable user metadata. A fresh profile lookup applies permission changes and deactivation to subsequent requests. Already-running requests can finish. The migration revokes anonymous/authenticated direct access to known SCM tables, views and RPC functions; the existing server APIs continue using the service role. It does not change unrelated database objects.

Staff requests that write are recorded in `scm_staff_activity` with actor, method, path and response status. Null response status means a request was started but no final response was recorded; it is not proof a business mutation committed. Existing business event fields now use verified staff identity rather than a Basic Auth username. This is request attribution, not a complete per-field change history.

## Before production deployment

1. With previous migrations already applied, run **042_staff_accounts.sql** in Supabase's SQL editor. Keep these in migration history using your usual process. Do not deploy the new staff code until the following steps are ready.
2. Set these environment variables locally and on the existing app host. Keep the existing service-role/McLeod/database configuration.

   ```dotenv
   SCM_APP_URL=https://scm-platform-pnl.vercel.app
   SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   SUPABASE_ANON_KEY=YOUR-SUPABASE-ANON-OR-PUBLISHABLE-KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR-EXISTING-SERVER-KEY
   ```

   `SCM_APP_URL` must be the exact origin you visit, without a path. Staff requests from other origins are rejected. For local development use `http://localhost:3000`; use a separate test Supabase project when exercising database writes. Never use the service-role key as the anon key.
3. In Supabase Auth, enable email/password sign-in and disable public signup. Set **Site URL** to the same production origin. Add `https://scm-platform-pnl.vercel.app/auth/accept` to allowed redirect URLs.
4. Configure **custom SMTP** and your verified sender. Supabase's default mail service only sends to project-team addresses, so it is not sufficient for warehouse employees. Keep SMTP credentials in Supabase, not this repo. Test delivery to your own address before inviting an operator.
5. Replace the link in the **Invite user** email template with:

   ```html
   <a href="{{ .SiteURL }}/auth/accept?token_hash={{ .TokenHash }}&amp;type=invite">Accept your SCM invitation</a>
   ```

   Replace the link in **Reset password** with:

   ```html
   <a href="{{ .SiteURL }}/auth/accept?token_hash={{ .TokenHash }}&amp;type=recovery">Set your SCM password</a>
   ```

   The acceptance page requires a Continue click before consuming the one-time token, which avoids consuming it on a simple email-scanner GET. Supabase controls the token's lifetime; the staff invitation itself is valid for seven days. Resend renews the pending invitation. Cancel disables it. If an email is already verified, resend sends a recovery link that follows the same staff access checks.
6. Bootstrap **your own administrator account**, substituting your actual email. This command writes the pending admin and sends the invitation; no invitation has been sent by this package.

   ```bash
   node scripts/bootstrap-staff.mjs --email "YOUR-ACTUAL-EMAIL" --name "Jaime" --send-invite
   ```

   If delivery fails, the pending admin remains. Fix SMTP/template configuration and rerun. Once an admin is active, the bootstrap command refuses further use; manage staff in the app instead.
7. Deploy the tested staff code through your normal SCM deployment. Open your invitation, click Continue, and set your password. The old `PNL_USERS` / `WAREHOUSE_USERS` credentials no longer grant access. Keep their old values securely available only if you need to roll back the code.
8. Open **Manage users**. Enter one Houston employee's name and email, choose **Warehouse operator → Houston**, and send the invitation. No employee is added as an administrator by default. You can resend/cancel pending invitations, change active users' roles/terminals, and deactivate access. You cannot change or deactivate your own access.

## Pilot verification

- In a private browser window, accept the Houston invitation. Confirm the landing page shows Houston and both 5300 and 4331.
- Test a non-production arrival at both Houston yards. Confirm Savannah links are hidden and attempts to access Savannah pages or records are blocked.
- Test a viewer account: search/history works and operational writes fail. Confirm financial modules and Manage users remain administrator-only.
- Deactivate the pilot account and confirm the next staff request is rejected. Verify a driver QR check-in still works independently.
- Finish an SCM cotton delivery from the Cotton tab. Confirm its Domestic Line entry disappears on refresh and is available in history.

## Validation and rollback

Run `node --test tests/*.test.mjs` and `npm run build`. Authentication tests use stubbed Auth/HTTP boundaries and database tests use PGlite; they do not send email, post to live McLeod, or prove production SMTP delivery. The production build can be checked with placeholder database environment values; real account acceptance and refresh should be checked during the pilot.

If staff sign-in is unavailable, roll the application back to the previous deployment while correcting the Auth configuration. The new tables can remain. Do not delete staff/account data as part of rollback. The service-role database grants remain available to the old server code. The cotton migration is independent and can remain enabled with its corresponding route fix.

Reference: [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Email setup before sending invites

Supabase Dashboard → Authentication → Email → SMTP Settings: enable custom SMTP and enter the SMTP host, port, username, password, sender email and sender name supplied by your email provider. The sender must be authorized by that provider. Do not paste SMTP passwords into chat or store them in the repository. Supabase’s default sender only delivers to project-team addresses, not ordinary staff.

Official reference: https://supabase.com/docs/guides/auth/auth-smtp
Email template reference: https://supabase.com/docs/guides/auth/auth-email-templates

The application does not create an SMTP account or change DNS for you. Finish that setup, then test the first administrator invitation before inviting employees. Neither live SMTP delivery nor production credentials were available for this package’s verification.

## Local apply and validation

```bash
cd /c/DEV/scm-platform &&
python -m zipfile -e ~/Downloads/scm-user-invitations.zip . &&
git apply --check scm-user-invitations.patch &&
git apply scm-user-invitations.patch &&
npm ci &&
node --test tests/*.test.mjs &&
npm run build
```

Do not push the authentication switch until migration 042, the app environment variables, and your pending administrator account are ready. The new code requires staff sign-in; existing shared credentials will not work with it. To test locally, set SCM_APP_URL=http://localhost:3000 in .env.local and visit that exact origin. Set the production SCM_APP_URL separately on the app host.

After the admin/email setup is ready, deploy with your usual git commit/push workflow, accept your admin invitation, then use Manage users → Warehouse operator → Houston.
