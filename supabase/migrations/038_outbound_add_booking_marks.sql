begin;

alter table public.cotton_outbound_booking_lines
  add column if not exists added_request_id uuid,
  add column if not exists added_by text;
create unique index if not exists idx_outbound_mark_added_request
  on public.cotton_outbound_booking_lines(added_request_id) where added_request_id is not null;

-- Add the booking line, total and assigned equipment row together. No inventory
-- is changed and retrying a timed-out request cannot add the same mark twice.
create or replace function public.add_cotton_outbound_booking_mark(
  p_booking_id uuid, p_terminal text, p_site_code text, p_expected_updated_at timestamptz,
  p_request_id uuid, p_mark text, p_bales integer, p_shipping_order text, p_changed_by text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_booking public.cotton_outbound_bookings%rowtype;
  v_existing public.cotton_outbound_booking_lines%rowtype;
  v_line_id uuid;
  v_slot_id uuid;
  v_row integer;
  v_sequence integer;
  v_mark text := upper(trim(coalesce(p_mark,'')));
  v_order text := nullif(trim(coalesce(p_shipping_order,'')), '');
begin
  select * into v_booking from public.cotton_outbound_bookings
    where id=p_booking_id and terminal=p_terminal and site_code=p_site_code for update;
  if not found then raise exception 'Booking not found at this warehouse'; end if;
  if p_request_id is null then raise exception 'Missing add-mark request identifier'; end if;
  select * into v_existing from public.cotton_outbound_booking_lines where added_request_id=p_request_id;
  if found then
    if v_existing.booking_id <> p_booking_id or v_existing.mark <> v_mark
      or v_existing.requested_bales is distinct from p_bales or v_existing.shipping_order is distinct from v_order then
      raise exception 'This add-mark request was already used; reload before trying again';
    end if;
    return v_existing.id;
  end if;
  if v_booking.status <> 'draft' then raise exception 'This booking is not an active draft'; end if;
  if p_expected_updated_at is null or v_booking.updated_at <> p_expected_updated_at then
    raise exception 'This booking changed; reload before adding a mark';
  end if;
  if v_mark = '' or length(v_mark)>80 or v_mark !~ '^[A-Z0-9][A-Z0-9 ._/-]*$'
    or p_bales is null or p_bales < 1 or p_bales > 1000000 or length(coalesce(v_order,''))>200 then
    raise exception 'Enter a valid mark, positive whole bale count, and optional shipping order';
  end if;
  if exists(select 1 from public.cotton_outbound_booking_lines
    where booking_id=p_booking_id and upper(trim(mark))=v_mark) then
    raise exception 'This mark is already on the booking';
  end if;
  select coalesce(max(source_row),0)+1 into v_row from public.cotton_outbound_booking_lines where booking_id=p_booking_id;
  insert into public.cotton_outbound_booking_lines(booking_id,source_row,mark,requested_bales,load_by,
    date_confirmed,shipping_order,source_warehouse,added_request_id,added_by)
  values(p_booking_id,v_row,v_mark,p_bales,
    coalesce(v_booking.cutoff::date,(select min(load_by) from public.cotton_outbound_booking_lines where booking_id=p_booking_id),current_date),
    false,v_order,v_booking.site_name,p_request_id,nullif(trim(coalesce(p_changed_by,'')),'')) returning id into v_line_id;
  update public.cotton_outbound_bookings set requested_bales=requested_bales+p_bales where id=p_booking_id;

  select id into v_slot_id from public.cotton_outbound_containers
    where booking_id=p_booking_id and booking_line_id is null and split_transfer_id is null
      and container_number is null and seal_number is null and chassis_number is null and notes is null
    order by sequence_no limit 1 for update;
  if v_slot_id is not null then
    update public.cotton_outbound_containers set booking_line_id=v_line_id,updated_by=p_changed_by where id=v_slot_id;
  else
    select coalesce(max(sequence_no),0)+1 into v_sequence from public.cotton_outbound_containers where booking_id=p_booking_id;
    insert into public.cotton_outbound_containers(booking_id,sequence_no,booking_line_id,updated_by)
      values(p_booking_id,v_sequence,v_line_id,p_changed_by);
  end if;
  return v_line_id;
end;
$$;
revoke all on function public.add_cotton_outbound_booking_mark(uuid,text,text,timestamptz,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.add_cotton_outbound_booking_mark(uuid,text,text,timestamptz,uuid,text,integer,text,text) to service_role;
commit;
