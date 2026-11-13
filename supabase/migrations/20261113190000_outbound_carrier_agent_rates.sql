alter table public.outbound_carrier_rates
  drop constraint outbound_carrier_rates_terminal_site_code_carrier_id_lane_key;

create unique index outbound_carrier_rates_agent_lane_key
  on public.outbound_carrier_rates (terminal, site_code, carrier_id, lower(btrim(carrier_name)), lane);
