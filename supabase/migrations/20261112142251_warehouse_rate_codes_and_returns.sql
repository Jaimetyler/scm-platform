alter table public.customer_service_rates
  add column rate_code integer generated always as identity unique,
  add column return_location text not null default '' check (length(return_location) <= 300),
  drop constraint customer_service_rates_scope_key,
  add constraint customer_service_rates_scope_key
    unique (terminal, site_code, customer_code, revenue_code, service_type, return_location);
