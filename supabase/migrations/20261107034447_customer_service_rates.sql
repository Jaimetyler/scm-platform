-- Customer/service scope prevents the Dallas rule affecting other warehouse flows.
create table public.customer_service_rates (
  id uuid primary key default gen_random_uuid(),
  terminal text not null,
  customer_code text not null,
  revenue_code text not null,
  service_type text not null,
  included_chassis_days integer not null default 0 check (included_chassis_days >= 0),
  chassis_daily_rate numeric(12,2) not null default 0 check (chassis_daily_rate >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (terminal, customer_code, revenue_code, service_type)
);
alter table public.customer_service_rates enable row level security;
revoke all on public.customer_service_rates from public, anon, authenticated;
grant select, insert, update, delete on public.customer_service_rates to service_role;
comment on table public.customer_service_rates is 'Customer service allowances. Drayage and FSC amounts remain sourced from McLeod until contracted lane rates are entered.';
insert into public.customer_service_rates
  (terminal, customer_code, revenue_code, service_type, included_chassis_days, chassis_daily_rate, notes)
values ('DAL', 'BUNGOMNE', 'DDRAY', 'drayage', 1, 45.00,
  'Confirmed by Jaime: negotiated drayage and FSC plus one $45 chassis day per order are standard; charges above that are extra.');
