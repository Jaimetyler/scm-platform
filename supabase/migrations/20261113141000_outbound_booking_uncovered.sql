create or replace view public.cotton_outbound_booking_search_dashboard with (security_invoker = true) as
select d.*, b.scm_file_number,
  array(select l.mark from public.cotton_outbound_booking_lines l where l.booking_id=d.id) as search_marks,
  array(select c.container_number from public.cotton_outbound_containers c where c.booking_id=d.id and c.container_number is not null) as search_containers,
  b.return_location, b.return_location_code, b.steamship_line,
  (select count(*)::integer
   from public.cotton_outbound_containers c
   where c.booking_id = d.id and c.split_transfer_id is null
     and nullif(trim(c.container_number), '') is not null) as loaded_containers,
  (select count(*)::integer
   from public.cotton_outbound_containers c
   left join public.cotton_outbound_booking_lines l on l.id = c.booking_line_id
   where c.booking_id = d.id and c.split_transfer_id is null
     and (c.booking_line_id is null or l.line_status = 'active')
     and nullif(trim(c.carrier_plan #>> '{rate,carrier_id}'), '') is null) as uncovered_containers
from public.cotton_outbound_booking_dashboard d
join public.cotton_outbound_bookings b on b.id=d.id;
revoke all on public.cotton_outbound_booking_search_dashboard from public, anon, authenticated;
grant select on public.cotton_outbound_booking_search_dashboard to service_role;
notify pgrst, 'reload schema';
