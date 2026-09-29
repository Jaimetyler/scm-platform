-- Tie equipment rows to booking marks and audit mark rollovers between bookings.
alter table public.cotton_outbound_containers
  add column if not exists booking_line_id uuid references public.cotton_outbound_booking_lines(id) on delete set null;
create index if not exists idx_cotton_outbound_containers_line
  on public.cotton_outbound_containers (booking_line_id)
  where booking_line_id is not null;

create table if not exists public.cotton_outbound_booking_transfers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_booking_id uuid not null references public.cotton_outbound_bookings(id),
  target_booking_id uuid not null references public.cotton_outbound_bookings(id),
  source_line_id uuid not null references public.cotton_outbound_booking_lines(id),
  target_line_id uuid not null references public.cotton_outbound_booking_lines(id),
  mark text not null,
  bales integer not null check (bales > 0),
  changed_by text,
  note text
);

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
  if exists (select 1 from public.cotton_outbound_containers where booking_line_id = v_line.id) then
    raise exception 'Clear this mark from its container row before rolling it to another booking';
  end if;
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
  return v_target.id;
end;
$$;

revoke all on public.cotton_outbound_booking_transfers from anon, authenticated;
grant select, insert, update, delete on public.cotton_outbound_booking_transfers to service_role;
revoke all on function public.roll_cotton_outbound_booking_line(uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.roll_cotton_outbound_booking_line(uuid,integer,text,text) to service_role;
