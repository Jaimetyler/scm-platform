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
      return_location = p_details->>'return_location', return_location_code = p_details->>'return_location_code'
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
  update public.cotton_outbound_bookings set scm_file_number = p_details->>'scm_file_number' where id = booking;
  update public.cotton_outbound_containers set booking_line_id = null where booking_id = booking;
  insert into public.dallas_dray_import_loads (booking_id, sequence_no, blnum, payload)
  select booking, ordinality::integer, payload->>'blnum', payload
  from jsonb_array_elements(p_loads) with ordinality as loads(payload, ordinality);
  return booking;
end;
$$;
revoke all on function public.start_dallas_dray_import(text,text,text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.start_dallas_dray_import(text,text,text,text,text,text,jsonb,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
