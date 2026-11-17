alter table public.cotton_outbound_bookings
  add column book_id text check (length(book_id) <= 80);

-- A single mark can draw bales from multiple source warehouses.
alter table public.cotton_outbound_booking_lines
  add column source_bales jsonb check (jsonb_typeof(source_bales) = 'array');

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
      return_location_code = nullif(trim(p_details->>'return_location_code'), ''),
      steamship_line = nullif(trim(p_details->>'steamship_line'), ''),
      book_id = nullif(trim(p_details->>'book_id'), '')
    where id = v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line->'sourceBales') = 'array' then
      update public.cotton_outbound_booking_lines
      set source_bales = v_line->'sourceBales'
      where booking_id = v_id and source_row = (v_line->>'sourceRow')::integer;
    end if;
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

create or replace function public.start_dallas_dray_import(
  p_site_code text, p_site_name text, p_customer text, p_booking_number text,
  p_customer_reference text, p_source_filename text, p_lines jsonb, p_details jsonb, p_loads jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  booking uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('dallas-dray:' || p_booking_number, 0));
  if nullif(p_details->>'restore_booking_id', '') is not null then
    select id into booking from public.cotton_outbound_bookings
    where id = (p_details->>'restore_booking_id')::uuid and terminal = 'DAL'
      and site_code = p_site_code and booking_number = p_booking_number and status = 'cancelled'
      and planned_containers = jsonb_array_length(p_loads)
    for update;
    if booking is null or exists (
      select 1 from public.cotton_outbound_bookings where terminal = 'DAL'
        and booking_number = p_booking_number and id <> booking
    ) or exists (select 1 from public.dallas_dray_import_loads where booking_id = booking)
      then raise unique_violation using message = 'Cancelled booking cannot be restored for import'; end if;
    perform id from public.cotton_outbound_containers where booking_id = booking for update;
    if (select count(*) from public.cotton_outbound_containers where booking_id = booking) <> jsonb_array_length(p_loads)
      or exists (select 1 from public.cotton_outbound_containers where booking_id = booking
        and (sequence_no > jsonb_array_length(p_loads) or split_transfer_id is not null
          or container_number is not null or chassis_number is not null or seal_number is not null
          or carrier_plan is not null or nullif(notes, '') is not null))
      or exists (select 1 from public.cotton_outbound_booking_lines where booking_id = booking and line_status <> 'active')
      then raise unique_violation using message = 'Cancelled booking already has saved load details or changed marks'; end if;
    update public.cotton_outbound_bookings set status = 'draft', erd = (p_details->>'erd')::date,
      doc_cutoff = (p_details->>'doc_cutoff')::timestamp, cutoff = (p_details->>'cutoff')::timestamp,
      doc_cutoff_has_time = (p_details->>'doc_cutoff_has_time')::boolean,
      cutoff_has_time = (p_details->>'cutoff_has_time')::boolean,
      vessel = p_details->>'vessel', steamship_line = p_details->>'steamship_line',
      return_location = p_details->>'return_location', return_location_code = p_details->>'return_location_code',
      book_id = coalesce(nullif(trim(p_details->>'book_id'), ''), book_id),
      customer_reference = case when p_details ? 'book_id' then nullif(p_customer_reference, '') else customer_reference end
    where id = booking;
  else
    if exists (select 1 from public.cotton_outbound_bookings where terminal = 'DAL' and booking_number = p_booking_number)
      then raise unique_violation using message = 'This Dallas booking already exists'; end if;
    booking := public.create_cotton_outbound_booking_import(
      'DAL', p_site_code, p_site_name, p_customer, p_booking_number, p_customer_reference,
      jsonb_array_length(p_loads), (select sum((entry->>'bales')::integer)::integer from jsonb_array_elements(p_lines) entry),
      p_source_filename, p_lines, p_details
    );
  end if;
  -- Older clients still send their legacy SCM file number field.
  if p_details ? 'scm_file_number' then
    update public.cotton_outbound_bookings set scm_file_number = p_details->>'scm_file_number' where id = booking;
  end if;
  update public.cotton_outbound_containers set booking_line_id = null where booking_id = booking;
  insert into public.dallas_dray_import_loads (booking_id, sequence_no, blnum, payload)
  select booking, ordinality::integer, payload->>'blnum', payload
  from jsonb_array_elements(p_loads) with ordinality as loads(payload, ordinality);
  return booking;
end;
$$;
revoke all on function public.start_dallas_dray_import(text,text,text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.start_dallas_dray_import(text,text,text,text,text,text,jsonb,jsonb,jsonb) to service_role;

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
     and nullif(trim(c.carrier_plan #>> '{rate,carrier_id}'), '') is null) as uncovered_containers,
  coalesce((
    select jsonb_agg(jsonb_build_object('code', carrier.code, 'name', carrier.name, 'count', carrier.load_count)
      order by carrier.load_count desc, carrier.code)
    from (
      select upper(trim(c.carrier_plan #>> '{rate,carrier_id}')) as code,
        max(nullif(trim(c.carrier_plan #>> '{rate,carrier_name}'), '')) as name,
        count(*)::integer as load_count
      from public.cotton_outbound_containers c
      left join public.cotton_outbound_booking_lines l on l.id = c.booking_line_id
      where c.booking_id = d.id and c.split_transfer_id is null
        and (c.booking_line_id is null or l.line_status = 'active')
        and nullif(trim(c.carrier_plan #>> '{rate,carrier_id}'), '') is not null
      group by upper(trim(c.carrier_plan #>> '{rate,carrier_id}'))
    ) carrier
  ), '[]'::jsonb) as carrier_breakdown,
  b.book_id
from public.cotton_outbound_booking_dashboard d
join public.cotton_outbound_bookings b on b.id=d.id;
revoke all on public.cotton_outbound_booking_search_dashboard from public, anon, authenticated;
grant select on public.cotton_outbound_booking_search_dashboard to service_role;
notify pgrst, 'reload schema';
