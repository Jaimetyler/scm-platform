-- Supabase default privileges can grant service_role ALL on new tables.
-- Revoke those inherited defaults explicitly before granting append/read access.
begin;
revoke all on public.inbound_physical_departure_events from public, anon, authenticated, service_role;
grant select, insert on public.inbound_physical_departure_events to service_role;
commit;
