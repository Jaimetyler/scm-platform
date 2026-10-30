-- Houston 4331 uses the same gate workflow as 5300, with its own QR token.
-- Set the 4331 gate pin and radius in Driver QR Setup before activating it.
insert into public.driver_checkin_sites (terminal, site_code, site_name, radius_m, active)
values ('HOU', '4331', 'Houston - 4331', 500, false)
on conflict (terminal, site_code) do update
  set site_name = excluded.site_name;
