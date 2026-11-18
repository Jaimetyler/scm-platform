create table public.inbound_transit_rates (
  customer_code text not null,
  pickup_city text not null check (btrim(pickup_city) <> ''),
  pickup_state text not null check (pickup_state ~ '^[A-Z]{2}$'),
  delivery_city text not null check (btrim(delivery_city) <> ''),
  delivery_state text not null check (delivery_state ~ '^[A-Z]{2}$'),
  delivery_code text,
  base_rate numeric(12,2) not null check (base_rate >= 0),
  order_type text not null,
  fuel_code text,
  source_file text not null,
  source_row integer not null check (source_row > 1),
  primary key (customer_code, pickup_city, pickup_state, delivery_city, delivery_state),
  check (order_type <> 'FLAT' or fuel_code is null)
);
alter table public.inbound_transit_rates enable row level security;
revoke all on public.inbound_transit_rates from anon, authenticated;
grant select, insert, update, delete on public.inbound_transit_rates to service_role;

create view public.inbound_transit_rates_with_miles
with (security_invoker = true) as
select r.*, m.miles as contract_miles
from public.inbound_transit_rates r
left join public.inbound_contract_miles m
  on m.customer_code = r.customer_code
 and m.pickup_city = r.pickup_city
 and m.pickup_state = r.pickup_state
 and m.delivery_code = r.delivery_code;
revoke all on public.inbound_transit_rates_with_miles from anon, authenticated;
grant select on public.inbound_transit_rates_with_miles to service_role;
