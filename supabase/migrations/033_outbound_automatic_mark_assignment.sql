-- Assign each imported mark to a fixed equipment row. Existing rows with equipment stay fixed.
create or replace function public.assign_cotton_outbound_booking_marks(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_line_count integer;
  v_container_count integer;
  v_max_sequence integer;
begin
  select count(*) into v_line_count from public.cotton_outbound_booking_lines where booking_id = p_booking_id;
  select count(*), coalesce(max(sequence_no), 0) into v_container_count, v_max_sequence
  from public.cotton_outbound_containers where booking_id = p_booking_id;
  if v_line_count > v_container_count then
    insert into public.cotton_outbound_containers (booking_id, sequence_no)
    select p_booking_id, v_max_sequence + n from generate_series(1, v_line_count - v_container_count) n
    on conflict (booking_id, sequence_no) do nothing;
  end if;

  with inventory as (
    select booking_line.id,
      coalesce(sum(case when lot.inventory_status = 'active'
        then greatest(0, lot.current_bales - lot.allocated_bales) else 0 end), 0) as available
    from public.cotton_outbound_booking_lines booking_line
    left join public.warehouse_inventory_lots lot on lot.mark = booking_line.mark
      and lot.terminal = (select terminal from public.cotton_outbound_bookings where id = p_booking_id)
      and lot.site_code = (select site_code from public.cotton_outbound_bookings where id = p_booking_id)
    where booking_line.booking_id = p_booking_id
    group by booking_line.id
  ), unassigned_lines as (
    select line.id, row_number() over (
      order by (inventory.available > 0) desc, line.mark, line.shipping_order nulls last, line.source_row
    ) as position
    from public.cotton_outbound_booking_lines line
    join inventory on inventory.id = line.id
    where line.booking_id = p_booking_id
      and not exists (select 1 from public.cotton_outbound_containers assigned where assigned.booking_line_id = line.id)
  ), empty_slots as (
    select container.id, row_number() over (order by container.sequence_no) as position
    from public.cotton_outbound_containers container
    where container.booking_id = p_booking_id and container.booking_line_id is null
  )
  update public.cotton_outbound_containers container
  set booking_line_id = line.id
  from empty_slots slot join unassigned_lines line on line.position = slot.position
  where container.id = slot.id;
end;
$$;

-- Reorder unused rows created by migration 031. Rows with entered equipment remain fixed.
update public.cotton_outbound_containers
set booking_line_id = null
where container_number is null and seal_number is null and chassis_number is null and notes is null;
do $$ declare booking record; begin
  for booking in select id from public.cotton_outbound_bookings loop
    perform public.assign_cotton_outbound_booking_marks(booking.id);
  end loop;
end $$;

-- New imports receive their fixed mark rows after all booking lines are created.
create or replace function public.create_cotton_outbound_booking_draft(
  p_terminal text, p_site_code text, p_site_name text, p_customer text,
  p_booking_number text, p_customer_reference text, p_containers integer,
  p_total_bales integer, p_source_filename text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_line jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 500 then raise exception 'Invalid booking lines'; end if;
  if p_total_bales <> (select sum((line->>'bales')::integer) from jsonb_array_elements(p_lines) line)
     then raise exception 'Booking bale total does not match its lines'; end if;
  insert into public.cotton_outbound_bookings
    (terminal, site_code, site_name, customer, booking_number, customer_reference,
     planned_containers, requested_bales, source_filename)
  values (p_terminal, p_site_code, p_site_name, p_customer, p_booking_number,
    nullif(p_customer_reference, ''), p_containers, p_total_bales, p_source_filename)
  returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.cotton_outbound_booking_lines
      (booking_id, source_row, mark, requested_bales, load_by, date_confirmed, shipping_order, source_warehouse_code, source_warehouse)
    values (v_id, (v_line->>'sourceRow')::integer, v_line->>'mark',
      (v_line->>'bales')::integer, (v_line->>'loadBy')::date,
      (v_line->>'confirmed')::boolean, nullif(v_line->>'shippingOrder', ''), nullif(v_line->>'warehouseCode', ''), v_line->>'warehouse');
  end loop;
  perform public.assign_cotton_outbound_booking_marks(v_id);
  return v_id;
end;
$$;

revoke all on function public.assign_cotton_outbound_booking_marks(uuid) from public, anon, authenticated;
grant execute on function public.assign_cotton_outbound_booking_marks(uuid) to service_role;

-- Rollovers release blank equipment rows and assign both bookings again.
create or replace function public.roll_cotton_outbound_booking_line(
  p_source_line_id uuid,
  p_bales integer,
  p_target_booking_number text,
  p_changed_by text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_line public.cotton_outbound_booking_lines%rowtype;
  v_source public.cotton_outbound_bookings%rowtype;
  v_target public.cotton_outbound_bookings%rowtype;
  v_target_line_id uuid;
  v_next_row integer;
begin
  select * into v_line from public.cotton_outbound_booking_lines where id = p_source_line_id for update;
  if not found then raise exception 'Booking mark not found'; end if;
  select * into v_source from public.cotton_outbound_bookings where id = v_line.booking_id for update;
  if p_bales < 1 or p_bales > v_line.requested_bales then raise exception 'Enter a bale count between 1 and %', v_line.requested_bales; end if;
  if nullif(upper(trim(coalesce(p_target_booking_number, ''))), '') is null then raise exception 'Enter the new booking number'; end if;
  if upper(trim(p_target_booking_number)) = v_source.booking_number then raise exception 'Choose a different booking number'; end if;
  if exists (select 1 from public.cotton_outbound_containers where booking_line_id = v_line.id
      and (container_number is not null or seal_number is not null or chassis_number is not null or notes is not null)) then
    raise exception 'Clear the equipment details from this mark before rolling it to another booking';
  end if;
  update public.cotton_outbound_containers set booking_line_id = null
  where booking_line_id = v_line.id;
  if p_bales = v_source.requested_bales then
    raise exception 'The final mark cannot be rolled from this booking. Change the booking number instead.';
  end if;

  select * into v_target from public.cotton_outbound_bookings
  where terminal = v_source.terminal and site_code = v_source.site_code
    and booking_number = upper(trim(p_target_booking_number))
  for update;
  if not found then
    insert into public.cotton_outbound_bookings
      (terminal, site_code, site_name, customer, booking_number, customer_reference,
       planned_containers, requested_bales, status, source_format, source_filename)
    values (v_source.terminal, v_source.site_code, v_source.site_name, v_source.customer,
      upper(trim(p_target_booking_number)), v_source.customer_reference, null, p_bales,
      'draft', 'rollover', 'Rolled from booking ' || v_source.booking_number)
    returning * into v_target;
  else
    if v_target.customer <> v_source.customer then raise exception 'The destination booking belongs to a different customer'; end if;
    if v_target.status <> 'draft' then raise exception 'The destination booking is not an active draft'; end if;
    update public.cotton_outbound_bookings set requested_bales = requested_bales + p_bales
    where id = v_target.id returning * into v_target;
  end if;

  select coalesce(max(source_row), 0) + 1 into v_next_row
  from public.cotton_outbound_booking_lines where booking_id = v_target.id;
  if p_bales = v_line.requested_bales then
    update public.cotton_outbound_booking_lines
    set booking_id = v_target.id, source_row = v_next_row
    where id = v_line.id returning id into v_target_line_id;
  else
    update public.cotton_outbound_booking_lines
    set requested_bales = requested_bales - p_bales where id = v_line.id;
    insert into public.cotton_outbound_booking_lines
      (booking_id, source_row, mark, requested_bales, load_by, date_confirmed,
       shipping_order, source_warehouse_code, source_warehouse)
    values (v_target.id, v_next_row, v_line.mark, p_bales, v_line.load_by,
      v_line.date_confirmed, v_line.shipping_order, v_line.source_warehouse_code, v_line.source_warehouse)
    returning id into v_target_line_id;
  end if;
  update public.cotton_outbound_bookings
  set requested_bales = requested_bales - p_bales where id = v_source.id;
  insert into public.cotton_outbound_booking_transfers
    (source_booking_id, target_booking_id, source_line_id, target_line_id, mark, bales, changed_by, note)
  values (v_source.id, v_target.id, v_line.id, v_target_line_id, v_line.mark, p_bales,
    nullif(trim(coalesce(p_changed_by, '')), ''), 'Rolled from booking ' || v_source.booking_number);
  perform public.assign_cotton_outbound_booking_marks(v_source.id);
  perform public.assign_cotton_outbound_booking_marks(v_target.id);
  return v_target.id;
end;
$$;
