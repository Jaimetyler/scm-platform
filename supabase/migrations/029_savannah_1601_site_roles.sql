-- Preserve 1701 records and QR token while removing its active check-in link.
update public.driver_checkin_sites
set active = false
where terminal = 'SAV' and site_code = '1701';

-- Configure the 1601 gate pin and activate its QR in Driver QR Setup.
insert into public.driver_checkin_sites (terminal, site_code, site_name, radius_m, active)
values ('SAV', '1601', 'Savannah - 1601', 500, false)
on conflict (terminal, site_code) do update
  set site_name = excluded.site_name;
