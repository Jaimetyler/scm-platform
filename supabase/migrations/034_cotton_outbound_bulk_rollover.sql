-- Move several full or partial booking marks together so the operation succeeds or fails as one unit.
create or replace function public.bulk_roll_cotton_outbound_booking_lines(
  p_source_booking_id uuid,
  p_moves jsonb,
  p_target_booking_number text,
  p_changed_by text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source public.cotton_outbound_bookings%rowtype;
  v_target_id uuid;
  v_move jsonb;
  v_line public.cotton_outbound_booking_lines%rowtype;
  v_total integer;
  v_count integer;
begin
  select * into v_source from public.cotton_outbound_bookings where id = p_source_booking_id for update;
  if not found then raise exception 'Source booking not found'; end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) < 1 or jsonb_array_length(p_moves) > 200 then
    raise exception 'Select between 1 and 200 marks';
  end if;
  if nullif(upper(trim(coalesce(p_target_booking_number, ''))), '') is null
     or upper(trim(p_target_booking_number)) = v_source.booking_number then
    raise exception 'Enter a different destination booking number';
  end if;
  select count(*), coalesce(sum((move->>'bales')::integer), 0)
  into v_count, v_total from jsonb_array_elements(p_moves) move;
  if v_count <> (select count(distinct move->>'lineId') from jsonb_array_elements(p_moves) move) then
    raise exception 'A mark was selected more than once';
  end if;
  if v_total >= v_source.requested_bales then
    raise exception 'At least one mark must remain on the source booking';
  end if;

  for v_move in select value from jsonb_array_elements(p_moves) loop
    if not coalesce(v_move->>'lineId', '') ~* '^[0-9a-f-]{36}$'
       or not coalesce(v_move->>'bales', '') ~ '^[0-9]+$' then raise exception 'Invalid mark selection'; end if;
    select * into v_line from public.cotton_outbound_booking_lines
    where id = (v_move->>'lineId')::uuid and booking_id = p_source_booking_id for update;
    if not found then raise exception 'A selected mark is no longer on this booking'; end if;
    if (v_move->>'bales')::integer < 1 or (v_move->>'bales')::integer > v_line.requested_bales then
      raise exception 'Enter a bale count between 1 and % for mark %', v_line.requested_bales, v_line.mark;
    end if;
    if exists (select 1 from public.cotton_outbound_containers where booking_line_id = v_line.id
      and (container_number is not null or seal_number is not null or chassis_number is not null or notes is not null)) then
      raise exception 'Clear the equipment details from mark % before rolling it', v_line.mark;
    end if;
  end loop;

  for v_move in select value from jsonb_array_elements(p_moves) loop
    v_target_id := public.roll_cotton_outbound_booking_line(
      (v_move->>'lineId')::uuid, (v_move->>'bales')::integer,
      upper(trim(p_target_booking_number)), p_changed_by
    );
  end loop;
  perform public.assign_cotton_outbound_booking_marks(p_source_booking_id);
  perform public.assign_cotton_outbound_booking_marks(v_target_id);
  return v_target_id;
end;
$$;
revoke all on function public.bulk_roll_cotton_outbound_booking_lines(uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.bulk_roll_cotton_outbound_booking_lines(uuid,jsonb,text,text) to service_role;
