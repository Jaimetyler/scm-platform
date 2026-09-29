-- Equipment details for each container planned on a cotton outbound booking.
create table if not exists public.cotton_outbound_containers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null references public.cotton_outbound_bookings(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  container_number text,
  seal_number text,
  chassis_number text,
  notes text,
  updated_by text,
  unique (booking_id, sequence_no)
);
create unique index if not exists idx_cotton_outbound_container_number
  on public.cotton_outbound_containers (booking_id, container_number)
  where container_number is not null;

create or replace function public.set_updated_at_cotton_outbound_container()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_set_updated_at_cotton_outbound_container on public.cotton_outbound_containers;
create trigger trg_set_updated_at_cotton_outbound_container
before update on public.cotton_outbound_containers
for each row execute function public.set_updated_at_cotton_outbound_container();

create or replace function public.ensure_cotton_outbound_container_slots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.planned_containers is not null then
    insert into public.cotton_outbound_containers (booking_id, sequence_no)
    select new.id, n from generate_series(1, new.planned_containers) n
    on conflict (booking_id, sequence_no) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ensure_cotton_outbound_container_slots on public.cotton_outbound_bookings;
create trigger trg_ensure_cotton_outbound_container_slots
after insert or update of planned_containers on public.cotton_outbound_bookings
for each row execute function public.ensure_cotton_outbound_container_slots();

-- Create slots for drafts imported before this migration.
insert into public.cotton_outbound_containers (booking_id, sequence_no)
select booking.id, n
from public.cotton_outbound_bookings booking
cross join lateral generate_series(1, booking.planned_containers) n
where booking.planned_containers is not null
on conflict (booking_id, sequence_no) do nothing;

revoke all on public.cotton_outbound_containers from anon, authenticated;
grant select, insert, update, delete on public.cotton_outbound_containers to service_role;
revoke all on function public.ensure_cotton_outbound_container_slots() from public, anon, authenticated;
grant execute on function public.ensure_cotton_outbound_container_slots() to service_role;
