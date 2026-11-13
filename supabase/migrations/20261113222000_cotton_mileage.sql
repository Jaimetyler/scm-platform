create table public.cotton_location_routing_miles (
  location_id uuid not null references public.cotton_location_master(id),
  delivery_code text not null,
  miles numeric not null check (miles > 0),
  order_count integer not null check (order_count > 0),
  first_bill_date date not null,
  last_bill_date date not null,
  primary key (location_id, delivery_code)
);

create table public.inbound_contract_miles (
  customer_code text not null,
  pickup_city text not null,
  pickup_state text not null,
  delivery_code text not null,
  miles numeric not null check (miles > 0),
  locked_order_count integer not null check (locked_order_count > 0),
  primary key (customer_code, pickup_city, pickup_state, delivery_code)
);

alter table public.cotton_location_routing_miles enable row level security;
alter table public.inbound_contract_miles enable row level security;
revoke all on public.cotton_location_routing_miles, public.inbound_contract_miles from public, anon, authenticated;
grant select, insert, update on public.cotton_location_routing_miles, public.inbound_contract_miles to service_role;
