alter table public.inbound_checkin_rows
  drop constraint inbound_checkin_rows_terminal_check,
  add constraint inbound_checkin_rows_terminal_check check (terminal in ('SAV', 'HOU', 'DAL'));

alter table public.driver_checkin_sites
  drop constraint driver_checkin_sites_terminal_check,
  add constraint driver_checkin_sites_terminal_check check (terminal in ('SAV', 'HOU', 'DAL'));

alter table public.warehouse_inventory_lots
  drop constraint warehouse_inventory_lots_terminal_check,
  add constraint warehouse_inventory_lots_terminal_check check (terminal in ('SAV', 'HOU', 'DAL'));

alter table public.cotton_outbound_bookings
  drop constraint cotton_outbound_bookings_terminal_check,
  add constraint cotton_outbound_bookings_terminal_check check (terminal in ('SAV', 'HOU', 'DAL'));

alter table public.scm_staff
  drop constraint scm_staff_terminal_check,
  add constraint scm_staff_terminal_check check (terminal in ('SAV', 'HOU', 'DAL'));

alter table public.inbound_results
  drop constraint inbound_results_terminal_check,
  add constraint inbound_results_terminal_check check (terminal in ('SAV', 'HOU', 'DAL'));

insert into public.driver_checkin_sites (terminal, site_code, site_name)
values
  ('DAL', 'SCMDDETX', 'Dallas - DeSoto (SCMDDETX)'),
  ('DAL', 'SCMDDATX', 'Dallas - SCMDDATX')
on conflict (terminal, site_code) do nothing;
