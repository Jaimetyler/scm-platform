alter table public.customer_service_rates
  add column site_code text not null default '',
  add column fuel_mode text not null default 'fuel_for_review'
    check (fuel_mode in ('all_in', 'base_plus_fsc', 'fuel_for_review')),
  add column base_rate numeric(12,2) check (base_rate >= 0),
  drop constraint customer_service_rates_terminal_customer_code_revenue_code__key,
  add constraint customer_service_rates_scope_key unique (terminal, site_code, customer_code, revenue_code, service_type);

update public.customer_service_rates
set fuel_mode = 'base_plus_fsc'
where terminal = 'DAL' and site_code = '' and customer_code = 'BUNGOMNE'
  and revenue_code = 'DDRAY' and service_type = 'drayage';
