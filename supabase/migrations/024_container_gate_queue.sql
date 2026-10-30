create table if not exists public.container_gate_queue (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checked_in_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text,

  driver_checkin_site_id uuid not null
    references public.driver_checkin_sites(id) on delete cascade,
  terminal text not null check (terminal in ('SAV', 'HOU')),
  site_code text not null,
  site_name text not null,
  driver_name text not null,

  driver_latitude double precision not null,
  driver_longitude double precision not null,
  driver_accuracy_m double precision not null,
  driver_distance_m double precision not null,
  location_verified_at timestamptz not null,

  queue_status text not null default 'waiting'
    check (queue_status in ('waiting', 'completed', 'cancelled'))
);

create index if not exists idx_container_gate_queue_active
  on public.container_gate_queue
    (terminal, site_code, queue_status, checked_in_at, id);

create or replace function public.set_updated_at_container_gate_queue()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_container_gate_queue
  on public.container_gate_queue;
create trigger trg_set_updated_at_container_gate_queue
before update on public.container_gate_queue
for each row execute function public.set_updated_at_container_gate_queue();

create or replace function public.container_queue_position(p_id uuid)
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from public.container_gate_queue q
  join public.container_gate_queue target on target.id = p_id
  where q.driver_checkin_site_id = target.driver_checkin_site_id
    and q.queue_status = 'waiting'
    and (q.checked_in_at, q.id) <= (target.checked_in_at, target.id)
    and target.queue_status = 'waiting';
$$;
