create table if not exists public.customer_xref (
  id bigserial primary key,
  raw_name text not null,
  normalized_name text generated always as (
    upper(trim(regexp_replace(raw_name, '\s+', ' ', 'g')))
  ) stored,
  mcleod_customer_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (normalized_name, mcleod_customer_id)
);

create table if not exists public.terminal_defaults (
  id bigserial primary key,
  terminal text not null check (terminal in ('SAV', 'HOU', 'DAL')),
  setup_name text not null default 'DEFAULT',
  origin_location_id text not null,
  destination_location_id text not null,
  revenue_code_id text not null,
  commodity_id text not null default 'COTTON',
  equipment_type_id text not null default 'C',
  ordered_by text not null default 'ECOTTON',
  order_type_id text not null default 'ECOTTON',
  order_mode text not null default 'T',
  rate_type text not null default 'F',
  rate_units numeric not null default 1,
  rate numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (terminal, setup_name)
);

create table if not exists public.tariff_charge_xref (
  id bigserial primary key,
  terminal text not null check (terminal in ('SAV', 'HOU', 'DAL')),
  tariff_id int not null,
  description text not null,
  mcleod_code text not null,
  default_units numeric not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (terminal, tariff_id)
);

create table if not exists public.order_import_runs (
  id uuid primary key default gen_random_uuid(),
  terminal text not null check (terminal in ('SAV', 'HOU', 'DAL')),
  setup_name text not null default 'DEFAULT',
  status text not null default 'pending',
  total_rows int not null default 0,
  valid_rows int not null default 0,
  error_rows int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.order_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.order_import_runs(id) on delete cascade,
  row_number int not null,
  raw_data jsonb not null,
  normalized_data jsonb,
  mcleod_payload jsonb,
  status text not null default 'pending',
  error_message text,
  mcleod_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);