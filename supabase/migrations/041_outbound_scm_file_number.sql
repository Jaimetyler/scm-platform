-- File numbers are text so leading zeros are preserved. Existing bookings remain unset.
alter table public.cotton_outbound_bookings
  add column if not exists scm_file_number text
  check (scm_file_number is null or (length(trim(scm_file_number)) between 1 and 80));
create index if not exists cotton_outbound_scm_file_number_idx
  on public.cotton_outbound_bookings (lower(scm_file_number)) where scm_file_number is not null;

-- Keep the existing dashboard column order intact for other consumers.
create or replace view public.cotton_outbound_booking_search_dashboard as
select d.*, b.scm_file_number,
  array(select l.mark from public.cotton_outbound_booking_lines l where l.booking_id=d.id) as search_marks,
  array(select c.container_number from public.cotton_outbound_containers c where c.booking_id=d.id and c.container_number is not null) as search_containers
from public.cotton_outbound_booking_dashboard d
join public.cotton_outbound_bookings b on b.id=d.id;
revoke all on public.cotton_outbound_booking_search_dashboard from anon, authenticated;
grant select on public.cotton_outbound_booking_search_dashboard to service_role;
