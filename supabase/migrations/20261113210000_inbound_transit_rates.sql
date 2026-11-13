create table public.inbound_transit_rates (
  id uuid primary key default gen_random_uuid(),
  rate_side text not null check (rate_side in ('customer', 'carrier')),
  account_code text not null check (account_code ~ '^[A-Z0-9_-]{1,30}$'),
  account_name text not null default '' check (length(account_name) <= 100),
  pickup_city text not null check (length(pickup_city) between 1 and 100),
  pickup_state text not null check (pickup_state ~ '^[A-Z]{2}$'),
  delivery_code text not null check (delivery_code ~ '^[A-Z0-9_-]{1,30}$'),
  flat_cents integer not null check (flat_cents >= 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (rate_side, account_code, pickup_city, pickup_state, delivery_code)
);
alter table public.inbound_transit_rates enable row level security;
revoke all on public.inbound_transit_rates from public, anon, authenticated;
grant select, insert, update on public.inbound_transit_rates to service_role;
