begin;

alter table public.cotton_outbound_booking_lines
  alter column load_by drop not null,
  add column if not exists line_status text not null default 'active' check (line_status in ('active','on_hold','cancelled')),
  add column if not exists load_source text not null default 'warehouse' check (load_source in ('warehouse','source_load')),
  add column if not exists status_note text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by text;
alter table public.cotton_outbound_bookings drop constraint if exists cotton_outbound_bookings_requested_bales_check;
alter table public.cotton_outbound_bookings add constraint cotton_outbound_bookings_requested_bales_check check (requested_bales >= 0);

create table public.cotton_outbound_mark_events (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  booking_id uuid not null references public.cotton_outbound_bookings(id),
  line_id uuid not null references public.cotton_outbound_booking_lines(id),
  action text not null, previous_status text not null, previous_source text not null,
  changed_by text, note text
);
create table public.cotton_outbound_source_arrivals (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  line_id uuid not null references public.cotton_outbound_booking_lines(id),
  checkin_id uuid references public.inbound_checkin_rows(id) on delete set null,
  mark text not null, arrival_terminal text not null, arrival_site_code text not null, arrival_site_name text not null,
  resolved_at timestamptz, resolved_by text,
  unique(line_id,checkin_id)
);
create index idx_outbound_source_marks on public.cotton_outbound_booking_lines(mark) where load_source='source_load' and line_status<>'cancelled';
create index idx_outbound_unresolved_source_arrivals on public.cotton_outbound_source_arrivals(line_id) where resolved_at is null;
revoke all on public.cotton_outbound_mark_events, public.cotton_outbound_source_arrivals from anon,authenticated;
grant select,insert,update,delete on public.cotton_outbound_mark_events, public.cotton_outbound_source_arrivals to service_role;

-- Same exact mark at any cotton yard is an exception to review, never an automatic receipt/conversion.
create or replace function public.flag_cotton_outbound_source_checkin()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.material_type='cotton' and coalesce(new.movement_direction,'delivery')='delivery'
    and new.checked_in_at is not null and new.yard_status is distinct from 'cancelled'
    and nullif(trim(new.mark),'') is not null then
    insert into public.cotton_outbound_source_arrivals(line_id,checkin_id,mark,arrival_terminal,arrival_site_code,arrival_site_name)
    select l.id,new.id,l.mark,new.terminal,new.site_code,new.site_name
    from public.cotton_outbound_booking_lines l join public.cotton_outbound_bookings b on b.id=l.booking_id
    where l.load_source='source_load' and l.line_status<>'cancelled' and b.status='draft'
      and upper(trim(l.mark))=upper(trim(new.mark))
    on conflict(line_id,checkin_id) do nothing;
  end if;
  return new;
end; $$;
create trigger trg_flag_outbound_source_checkin after insert or update of mark,checked_in_at,material_type,movement_direction,yard_status
on public.inbound_checkin_rows for each row execute function public.flag_cotton_outbound_source_checkin();

-- Also flag a source row imported after the truck has already joined the active line.
create or replace function public.flag_cotton_outbound_source_line()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.load_source='source_load' and new.line_status<>'cancelled' then
    insert into public.cotton_outbound_source_arrivals(line_id,checkin_id,mark,arrival_terminal,arrival_site_code,arrival_site_name)
    select new.id,r.id,new.mark,r.terminal,r.site_code,r.site_name from public.inbound_checkin_rows r
    where upper(trim(r.mark))=upper(trim(new.mark)) and r.material_type='cotton'
      and coalesce(r.movement_direction,'delivery')='delivery' and r.checked_in_at is not null
      and r.yard_status in ('waiting','called','in_door','working')
    on conflict(line_id,checkin_id) do nothing;
  end if;
  return new;
end; $$;
create trigger trg_flag_outbound_source_line after insert or update of load_source,line_status,mark
on public.cotton_outbound_booking_lines for each row execute function public.flag_cotton_outbound_source_line();

create or replace function public.change_cotton_outbound_mark(
  p_booking_id uuid,p_line_id uuid,p_terminal text,p_site_code text,p_expected_updated_at timestamptz,
  p_action text,p_note text,p_changed_by text
) returns void language plpgsql security definer set search_path=public as $$
declare b public.cotton_outbound_bookings%rowtype; l public.cotton_outbound_booking_lines%rowtype;
begin
  select * into b from public.cotton_outbound_bookings where id=p_booking_id and terminal=p_terminal and site_code=p_site_code for update;
  if not found or b.status<>'draft' then raise exception 'Active booking not found at this warehouse'; end if;
  if p_expected_updated_at is null or b.updated_at<>p_expected_updated_at then raise exception 'This booking changed; reload and review it'; end if;
  select * into l from public.cotton_outbound_booking_lines where id=p_line_id and booking_id=p_booking_id for update;
  if not found then raise exception 'Mark not found on this booking'; end if;
  perform 1 from public.cotton_outbound_containers where booking_line_id=l.id for update;
  if l.line_status='cancelled' then raise exception 'This mark is already cancelled'; end if;
  if p_action not in ('hold','resume','cancel','warehouse','keep_source') or p_action is null then raise exception 'Unknown mark action'; end if;
  if length(coalesce(p_note,''))>500 then raise exception 'Note must be 500 characters or fewer'; end if;
  if p_action='resume' and l.line_status<>'on_hold' then raise exception 'Only held marks can be resumed'; end if;
  if p_action='hold' and l.line_status<>'active' then raise exception 'This mark is already on hold'; end if;
  if p_action in ('warehouse','keep_source') and l.load_source<>'source_load' then raise exception 'This mark is already a warehouse load'; end if;
  if p_action='keep_source' and nullif(trim(p_note),'') is null then raise exception 'Add a note explaining why this arrival stays a source load'; end if;
  insert into public.cotton_outbound_mark_events(booking_id,line_id,action,previous_status,previous_source,changed_by,note)
  values(b.id,l.id,p_action,l.line_status,l.load_source,p_changed_by,nullif(trim(p_note),''));
  update public.cotton_outbound_booking_lines set
    line_status=case p_action when 'hold' then 'on_hold' when 'resume' then 'active' when 'cancel' then 'cancelled' else line_status end,
    load_source=case when p_action='warehouse' then 'warehouse' else load_source end,
    status_note=case when p_action='resume' then null else nullif(trim(p_note),'') end,
    status_changed_at=clock_timestamp(),status_changed_by=p_changed_by where id=l.id;
  update public.cotton_outbound_bookings set requested_bales=requested_bales-case when p_action='cancel' then l.requested_bales else 0 end where id=b.id;
  if p_action in ('warehouse','keep_source','cancel') then
    update public.cotton_outbound_source_arrivals set resolved_at=clock_timestamp(),resolved_by=p_changed_by
    where line_id=l.id and resolved_at is null;
  end if;
end; $$;
revoke all on function public.change_cotton_outbound_mark(uuid,uuid,text,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.change_cotton_outbound_mark(uuid,uuid,text,text,timestamptz,text,text,text) to service_role;

-- A stale equipment save or split must not reactivate a held/cancelled mark.
create or replace function public.guard_cotton_outbound_mark_equipment()
returns trigger language plpgsql as $$
declare v_status text;
begin
  if tg_op='UPDATE' and old.booking_line_id is not null then
    select line_status into v_status from public.cotton_outbound_booking_lines where id=old.booking_line_id for share;
    if v_status<>'active' then raise exception 'Equipment for held or cancelled marks is locked'; end if;
  end if;
  if new.booking_line_id is not null then
    select line_status into v_status from public.cotton_outbound_booking_lines where id=new.booking_line_id and booking_id=new.booking_id for share;
    if v_status is null or v_status<>'active' then raise exception 'Choose an active mark on this booking'; end if;
  end if;
  return new;
end; $$;
create trigger trg_guard_outbound_mark_equipment before insert or update on public.cotton_outbound_containers
for each row execute function public.guard_cotton_outbound_mark_equipment();

create or replace view public.cotton_outbound_booking_dashboard as
select b.*,
  (select count(*)::int from (
    select l.mark,sum(l.requested_bales) requested from public.cotton_outbound_booking_lines l
    where l.booking_id=b.id and l.line_status='active' and l.load_source='warehouse' group by l.mark
  ) wanted where wanted.requested>coalesce((select sum(i.current_bales) from public.warehouse_inventory_lots i
    where i.terminal=b.terminal and i.site_code=b.site_code and i.mark=wanted.mark and i.inventory_status in ('active','on_hold')),0)) as missing_marks,
  (select count(distinct mark)::int from public.cotton_outbound_booking_lines where booking_id=b.id and line_status<>'cancelled' and load_source='source_load') as source_loads,
  (select count(distinct mark)::int from public.cotton_outbound_booking_lines where booking_id=b.id and line_status='on_hold') as held_marks,
  (select count(distinct a.line_id)::int from public.cotton_outbound_source_arrivals a join public.cotton_outbound_booking_lines l on l.id=a.line_id
    where l.booking_id=b.id and l.line_status<>'cancelled' and a.resolved_at is null) as source_arrivals
from public.cotton_outbound_bookings b;
revoke all on public.cotton_outbound_booking_dashboard from anon,authenticated;
grant select on public.cotton_outbound_booking_dashboard to service_role;

-- Updated import and split functions follow below.

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
      (booking_id, source_row, mark, requested_bales, load_by, date_confirmed, shipping_order, source_warehouse_code, source_warehouse, load_source)
    values (v_id, (v_line->>'sourceRow')::integer, v_line->>'mark',
      (v_line->>'bales')::integer, nullif(v_line->>'loadBy','')::date,
      (v_line->>'confirmed')::boolean, nullif(v_line->>'shippingOrder', ''), nullif(v_line->>'warehouseCode', ''), v_line->>'warehouse', coalesce(v_line->>'loadSource','warehouse'));
  end loop;
  perform public.assign_cotton_outbound_booking_marks(v_id);
  return v_id;
end;
$$;


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
  v_transfer_id uuid;
begin
  select * into v_line from public.cotton_outbound_booking_lines where id = p_source_line_id for update;
  if not found then raise exception 'Booking mark not found'; end if;
  if v_line.line_status<>'active' then raise exception 'Resume held marks before splitting; cancelled marks cannot be split'; end if;
  select * into v_source from public.cotton_outbound_bookings where id = v_line.booking_id for update;
  if p_bales < 1 or p_bales > v_line.requested_bales then raise exception 'Enter a bale count between 1 and %', v_line.requested_bales; end if;
  if nullif(upper(trim(coalesce(p_target_booking_number, ''))), '') is null then raise exception 'Enter the new booking number'; end if;
  if upper(trim(p_target_booking_number)) = v_source.booking_number then raise exception 'Choose a different booking number'; end if;
  if exists (select 1 from public.cotton_outbound_containers where booking_line_id = v_line.id
      and (container_number is not null or seal_number is not null or chassis_number is not null or notes is not null)) then
    raise exception 'Clear the equipment details from this mark before rolling it to another booking';
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
       shipping_order, source_warehouse_code, source_warehouse, load_source)
    values (v_target.id, v_next_row, v_line.mark, p_bales, v_line.load_by,
      v_line.date_confirmed, v_line.shipping_order, v_line.source_warehouse_code, v_line.source_warehouse, v_line.load_source)
    returning id into v_target_line_id;
  end if;
  update public.cotton_outbound_bookings
  set requested_bales = requested_bales - p_bales where id = v_source.id;
  insert into public.cotton_outbound_booking_transfers
    (source_booking_id, target_booking_id, source_line_id, target_line_id, mark, bales, changed_by, note)
  values (v_source.id, v_target.id, v_line.id, v_target_line_id, v_line.mark, p_bales,
    nullif(trim(coalesce(p_changed_by, '')), ''), 'Rolled from booking ' || v_source.booking_number)
  returning id into v_transfer_id;
  if p_bales = v_line.requested_bales then
    update public.cotton_outbound_containers
    set booking_line_id = null, split_transfer_id = v_transfer_id
    where booking_id = v_source.id and booking_line_id = v_line.id;
  end if;
  perform public.assign_cotton_outbound_booking_marks(v_source.id);
  perform public.assign_cotton_outbound_booking_marks(v_target.id);
  return v_target.id;
end;
$$;


notify pgrst, 'reload schema';
commit;
