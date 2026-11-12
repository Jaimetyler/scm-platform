create table public.outbound_carrier_rates (
  id uuid primary key default gen_random_uuid(),
  terminal text not null,
  site_code text not null,
  carrier_id text not null check (length(carrier_id) between 1 and 30),
  carrier_name text not null check (length(carrier_name) between 1 and 100),
  lane text not null check (length(lane) between 1 and 100),
  rates jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (terminal, site_code, carrier_id, lane)
);

alter table public.outbound_carrier_rates enable row level security;
revoke all on public.outbound_carrier_rates from public, anon, authenticated;
grant select, insert, update on public.outbound_carrier_rates to service_role;

alter table public.cotton_outbound_containers
  add column carrier_plan jsonb,
  add constraint outbound_carrier_plan_requires_equipment check (
    carrier_plan is null or (container_number is not null and split_transfer_id is null)
  );
