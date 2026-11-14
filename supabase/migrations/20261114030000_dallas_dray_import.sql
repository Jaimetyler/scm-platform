create table public.dallas_dray_import_loads (
  booking_id uuid not null references public.cotton_outbound_bookings(id) on delete restrict,
  sequence_no integer not null,
  blnum text primary key,
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending','writing','verified','review')),
  order_id text unique,
  unique (booking_id, sequence_no)
);
alter table public.dallas_dray_import_loads enable row level security;
revoke all on public.dallas_dray_import_loads from public, anon, authenticated;
grant select, insert, update on public.dallas_dray_import_loads to service_role;

create function public.start_dallas_dray_import(
  p_site_code text, p_site_name text, p_customer text, p_booking_number text,
  p_customer_reference text, p_source_filename text, p_lines jsonb, p_details jsonb, p_loads jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  booking uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('dallas-dray:' || p_booking_number, 0));
  if exists (select 1 from public.cotton_outbound_bookings where terminal = 'DAL' and booking_number = p_booking_number)
    then raise unique_violation using message = 'This Dallas booking already exists'; end if;
  booking := public.create_cotton_outbound_booking_import(
    'DAL', p_site_code, p_site_name, p_customer, p_booking_number, p_customer_reference,
    jsonb_array_length(p_loads), (select sum((entry->>'bales')::integer)::integer from jsonb_array_elements(p_lines) entry),
    p_source_filename, p_lines, p_details
  );
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
