begin;
alter table public.cotton_outbound_bookings
  add column if not exists doc_cutoff_has_time boolean not null default true,
  add column if not exists cutoff_has_time boolean not null default true;

create or replace function public.create_cotton_outbound_booking_draft_with_details(
  p_terminal text, p_site_code text, p_site_name text, p_customer text,
  p_booking_number text, p_customer_reference text, p_containers integer,
  p_total_bales integer, p_source_filename text, p_lines jsonb, p_details jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := public.create_cotton_outbound_booking_draft(p_terminal, p_site_code, p_site_name, p_customer,
    p_booking_number, p_customer_reference, p_containers, p_total_bales, p_source_filename, p_lines);
  update public.cotton_outbound_bookings
  set erd = nullif(p_details->>'erd', '')::date,
    doc_cutoff = nullif(p_details->>'doc_cutoff', '')::timestamp without time zone,
    cutoff = nullif(p_details->>'cutoff', '')::timestamp without time zone,
    vessel = nullif(trim(p_details->>'vessel'), ''),
    doc_cutoff_has_time = coalesce((p_details->>'doc_cutoff_has_time')::boolean, false),
    cutoff_has_time = coalesce((p_details->>'cutoff_has_time')::boolean, false)
  where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.create_cotton_outbound_booking_draft_with_details(text,text,text,text,text,text,integer,integer,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_cotton_outbound_booking_draft_with_details(text,text,text,text,text,text,integer,integer,text,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
