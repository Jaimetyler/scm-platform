-- Physical departure is independent of the remote McLeod settlement state.
-- Additive only: never change the existing 046 write-uncertainty guard.
begin;
alter table public.inbound_checkin_rows
  add column if not exists physical_departed_at timestamptz;

create table if not exists public.inbound_physical_departure_events (
  checkin_id uuid primary key references public.inbound_checkin_rows(id),
  departed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  actor text not null,
  previous_yard_status text,
  previous_draft_status text,
  previous_mcleod_phase text
);
alter table public.inbound_physical_departure_events enable row level security;
revoke all on public.inbound_physical_departure_events from public, anon, authenticated;
grant select, insert on public.inbound_physical_departure_events to service_role;

create function public.audit_inbound_physical_departure()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.physical_departed_at is not null and
     new.physical_departed_at is distinct from old.physical_departed_at then
    raise exception 'Physical departure is immutable; use an audited correction process';
  end if;
  if old.physical_departed_at is null and new.physical_departed_at is not null then
    if old.checked_in_at is null or new.physical_departed_at < old.checked_in_at or
       new.physical_departed_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'Invalid physical departure timestamp';
    end if;
    insert into public.inbound_physical_departure_events
      (checkin_id, departed_at, actor, previous_yard_status, previous_draft_status, previous_mcleod_phase)
      values (new.id, new.physical_departed_at, coalesce(nullif(new.yard_updated_by,''),'receiving staff'),
        old.yard_status, old.draft_status, old.mcleod_processing_phase);
  end if;
  return new;
end $$;
create trigger audit_inbound_physical_departure
  before update on public.inbound_checkin_rows
  for each row execute function public.audit_inbound_physical_departure();
commit;
