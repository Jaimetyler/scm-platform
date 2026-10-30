# Cotton completion and the Domestic Line

The Cotton tab previously saved `draft_status = processed` while leaving the separate `yard_status` active. The Domestic Line uses `yard_status`, so refreshing did not resolve the discrepancy.

Migration 040 completes the yard status in the same database write as a successfully processed SCM cotton delivery. It uses the existing verification time, falling back to the processing time, and preserves any existing completion time. The Domestic Line's normal refresh (every ten seconds) then removes the truck from the active queue; its record remains in history.

The migration also repairs already-processed SCM cotton deliveries still marked waiting, called, in door, or working. It does not call McLeod or post deliveries again. Failed, processing, outside-carrier, shortage-blocked, pickup, lumber, cancelled, and already-completed rows are not changed by this repair. Those workflows retain their existing checkout behavior.

The Domestic Line route recognizes when cotton processing has already completed the yard record and returns success rather than attempting a conflicting second checkout.

Apply the route change and run the test/build, then run `supabase/migrations/040_cotton_completion_yard_status.sql` in the Supabase SQL editor before deploying. The SQL runs in a transaction. After deployment, verify one already-processed row has moved to history and finish one new SCM cotton delivery from the Cotton tab. Check the line after its next refresh.
