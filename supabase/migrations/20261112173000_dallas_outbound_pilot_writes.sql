create table public.dallas_outbound_pilot_writes (
  booking_number text not null,
  container_number text not null,
  action text not null check (action in ('create', 'update')),
  state text not null check (state in ('writing', 'verified', 'review')),
  order_id text,
  actor text not null,
  created_at timestamptz not null default now(),
  primary key (booking_number, container_number)
);

alter table public.dallas_outbound_pilot_writes enable row level security;
revoke all on public.dallas_outbound_pilot_writes from public, anon, authenticated;
grant select, insert, update, delete on public.dallas_outbound_pilot_writes to service_role;
