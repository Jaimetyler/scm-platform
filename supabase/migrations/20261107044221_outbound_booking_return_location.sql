alter table public.cotton_outbound_bookings
  add column return_location text check (return_location is null or length(return_location) <= 300),
  add column return_location_code text check (return_location_code is null or length(return_location_code) <= 40);
create index cotton_outbound_return_code_idx on public.cotton_outbound_bookings(terminal, return_location_code)
  where return_location_code is not null;

-- Save source equipment in the same transaction as the booking and its mark assignments.
create or replace function public.create_cotton_outbound_booking_import(
  p_terminal text, p_site_code text, p_site_name text, p_customer text,
  p_booking_number text, p_customer_reference text, p_containers integer,
  p_total_bales integer, p_source_filename text, p_lines jsonb, p_details jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_line jsonb;
  v_container text;
  v_slot uuid;
begin
  v_id := public.create_cotton_outbound_booking_draft_with_details(
    p_terminal, p_site_code, p_site_name, p_customer, p_booking_number, p_customer_reference,
    p_containers, p_total_bales, p_source_filename, p_lines, p_details);
  update public.cotton_outbound_bookings
    set source_format = coalesce(nullif(p_details->>'source_format',''), 'bunge'),
      return_location = nullif(trim(p_details->>'return_location'), ''),
      return_location_code = nullif(trim(p_details->>'return_location_code'), '') where id = v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_container := nullif(upper(trim(v_line->>'containerNumber')), '');
    if v_container is null then continue; end if;
    if v_container !~ '^[A-Z]{4}[0-9]{7}$' then raise exception 'Invalid source container number'; end if;
    if exists (select 1 from public.cotton_outbound_containers where booking_id = v_id and container_number = v_container)
      then raise exception 'Repeated source container number'; end if;
    select c.id into v_slot from public.cotton_outbound_containers c
      join public.cotton_outbound_booking_lines l on l.id = c.booking_line_id
      where l.booking_id = v_id and l.source_row = (v_line->>'sourceRow')::integer
        and c.container_number is null and c.split_transfer_id is null
      order by c.sequence_no limit 1;
    if v_slot is null then raise exception 'Source container could not be assigned to its mark'; end if;
    update public.cotton_outbound_containers set container_number = v_container where id = v_slot;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.create_cotton_outbound_booking_import(text,text,text,text,text,text,integer,integer,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_cotton_outbound_booking_import(text,text,text,text,text,text,integer,integer,text,jsonb,jsonb) to service_role;

-- Append fields without changing the existing dashboard column order.
create or replace view public.cotton_outbound_booking_search_dashboard with (security_invoker = true) as
select d.*, b.scm_file_number,
  array(select l.mark from public.cotton_outbound_booking_lines l where l.booking_id=d.id) as search_marks,
  array(select c.container_number from public.cotton_outbound_containers c where c.booking_id=d.id and c.container_number is not null) as search_containers,
  b.return_location, b.return_location_code
from public.cotton_outbound_booking_dashboard d
join public.cotton_outbound_bookings b on b.id=d.id;
revoke all on public.cotton_outbound_booking_search_dashboard from public, anon, authenticated;
grant select on public.cotton_outbound_booking_search_dashboard to service_role;
notify pgrst, 'reload schema';
