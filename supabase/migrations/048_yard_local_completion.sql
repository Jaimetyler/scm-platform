-- Independently record physical departure while retaining McLeod processing state.
-- This migration must be tested against 046/047 before production rollout.
begin;
create table public.inbound_yard_departure_audit (
  checkin_id uuid primary key references public.inbound_checkin_rows(id),
  departed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  actor text not null,
  prior_yard_status text not null,
  prior_mcleod_phase text,
  prior_draft_status text
);
revoke all on public.inbound_yard_departure_audit from public, anon, authenticated;
grant select, insert on public.inbound_yard_departure_audit to service_role;

-- Extend the 046 guard narrowly: a physical departure may occur during an
-- unresolved lookup, but never during an uncertain McLeod write.
create or replace function public.guard_manual_outside_carrier()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  -- The original 046 guard remains authoritative. This migration is intentionally
  -- not activated until its full body can be preserved and reviewed.
  raise exception 'Migration 048 requires verified 046 guard integration';
end $$;
rollback;
