-- Warehouse inventory foundation. Run this before deploying /warehouse/inventory.
-- A completed check-in creates exactly one inventory lot. The event table is
-- intentionally append-only so future cotton breaks can preserve lineage.

create table if not exists public.warehouse_inventory_lots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  source_type text not null default 'checkin'
    check (source_type in ('checkin', 'manual', 'import', 'break')),
  source_checkin_id uuid unique references public.inbound_checkin_rows(id),

  terminal text not null check (terminal in ('SAV', 'HOU')),
  site_code text not null,
  site_name text not null,
  sub_location text not null default 'MAIN',

  received_date date,
  mark text not null,
  customer text not null,
  bol_bc integer,
  original_bales integer not null check (original_bales > 0),
  current_bales integer not null check (current_bales >= 0),
  allocated_bales integer not null default 0 check (allocated_bales >= 0),
  missing_bales integer not null default 0 check (missing_bales >= 0),
  warehouse_location text,
  booking_number text,
  inventory_status text not null default 'active'
    check (inventory_status in ('active', 'on_hold', 'closed')),
  ecotton_receipt_status text not null default 'pending'
    check (ecotton_receipt_status in ('not_ready', 'pending', 'created', 'failed', 'not_required')),
  source_notes text,
  notes text,

  constraint warehouse_inventory_allocated_within_current
    check (allocated_bales <= current_bales)
);

create index if not exists idx_warehouse_inventory_site
  on public.warehouse_inventory_lots (terminal, site_code, inventory_status, received_date desc);

create index if not exists idx_warehouse_inventory_mark
  on public.warehouse_inventory_lots (terminal, site_code, mark);

create index if not exists idx_warehouse_inventory_booking
  on public.warehouse_inventory_lots (terminal, site_code, booking_number)
  where booking_number is not null;

create table if not exists public.warehouse_inventory_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  inventory_lot_id uuid not null references public.warehouse_inventory_lots(id),
  event_type text not null check (event_type in (
    'receipt', 'source_correction', 'adjustment', 'location_change',
    'booking_allocation', 'booking_release', 'status_change', 'break',
    'shipment', 'update'
  )),
  quantity_delta integer not null default 0,
  from_mark text,
  to_mark text,
  from_location text,
  to_location text,
  booking_number text,
  changed_by text,
  note text,
  before_values jsonb,
  after_values jsonb
);

create index if not exists idx_warehouse_inventory_events_lot
  on public.warehouse_inventory_events (inventory_lot_id, created_at desc);

create or replace function public.set_updated_at_warehouse_inventory_lot()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_warehouse_inventory_lot
  on public.warehouse_inventory_lots;

create trigger trg_set_updated_at_warehouse_inventory_lot
before update on public.warehouse_inventory_lots
for each row execute function public.set_updated_at_warehouse_inventory_lot();

create or replace function public.sync_completed_checkin_to_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.warehouse_inventory_lots%rowtype;
  v_saved public.warehouse_inventory_lots%rowtype;
  v_adjusted_current integer;
begin
  if new.draft_status not in ('processed', 'outside_carrier') then
    return new;
  end if;

  if nullif(trim(coalesce(new.mark, '')), '') is null
     or nullif(trim(coalesce(new.shipper, '')), '') is null
     or new.bale_count is null or new.bale_count <= 0 then
    return new;
  end if;

  select * into v_existing
  from public.warehouse_inventory_lots
  where source_checkin_id = new.id
  for update;

  if not found then
    insert into public.warehouse_inventory_lots (
      source_type, source_checkin_id, terminal, site_code, site_name,
      sub_location, received_date, mark, customer, bol_bc, original_bales,
      current_bales, warehouse_location, ecotton_receipt_status, source_notes
    ) values (
      'checkin', new.id, new.terminal, new.site_code, new.site_name,
      coalesce(nullif(trim(new.sub_location), ''), 'MAIN'), new.received_date,
      upper(trim(new.mark)), upper(trim(new.shipper)), new.bol_bc,
      new.bale_count, new.bale_count, nullif(upper(trim(coalesce(new.warehouse_location, ''))), ''),
      case when nullif(trim(coalesce(new.warehouse_location, '')), '') is null
        then 'not_ready' else 'pending' end,
      nullif(trim(concat_ws(E'\n', new.comment_1, new.comment_2)), '')
    ) returning * into v_saved;

    insert into public.warehouse_inventory_events (
      inventory_lot_id, event_type, quantity_delta, to_mark, to_location,
      changed_by, note, after_values
    ) values (
      v_saved.id, 'receipt', v_saved.current_bales, v_saved.mark,
      v_saved.warehouse_location, 'check-in workflow',
      'Inventory created from completed inbound check-in', to_jsonb(v_saved)
    );
    return new;
  end if;

  v_adjusted_current := v_existing.current_bales + (new.bale_count - v_existing.original_bales);
  if v_adjusted_current < 0 or v_adjusted_current < v_existing.allocated_bales then
    raise exception 'Check-in correction would make inventory lower than its allocated quantity';
  end if;

  update public.warehouse_inventory_lots
  set terminal = new.terminal,
      site_code = new.site_code,
      site_name = new.site_name,
      sub_location = coalesce(nullif(trim(new.sub_location), ''), 'MAIN'),
      received_date = new.received_date,
      mark = upper(trim(new.mark)),
      customer = upper(trim(new.shipper)),
      bol_bc = new.bol_bc,
      original_bales = new.bale_count,
      current_bales = v_adjusted_current,
      warehouse_location = nullif(upper(trim(coalesce(new.warehouse_location, ''))), ''),
      ecotton_receipt_status = case
        when ecotton_receipt_status in ('created', 'not_required') then ecotton_receipt_status
        when nullif(trim(coalesce(new.warehouse_location, '')), '') is null then 'not_ready'
        else 'pending'
      end,
      source_notes = nullif(trim(concat_ws(E'\n', new.comment_1, new.comment_2)), '')
  where id = v_existing.id
  returning * into v_saved;

  if to_jsonb(v_existing) - array['updated_at']::text[]
     is distinct from to_jsonb(v_saved) - array['updated_at']::text[] then
    insert into public.warehouse_inventory_events (
      inventory_lot_id, event_type, quantity_delta, from_mark, to_mark,
      from_location, to_location, changed_by, note, before_values, after_values
    ) values (
      v_saved.id, 'source_correction', v_saved.current_bales - v_existing.current_bales,
      v_existing.mark, v_saved.mark, v_existing.warehouse_location,
      v_saved.warehouse_location, 'check-in workflow',
      'Inventory synchronized after a completed check-in correction',
      to_jsonb(v_existing), to_jsonb(v_saved)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_completed_checkin_to_inventory
  on public.inbound_checkin_rows;

create trigger trg_sync_completed_checkin_to_inventory
after insert or update of draft_status, received_date, mark, shipper, bol_bc,
  bale_count, warehouse_location, sub_location, comment_1, comment_2
on public.inbound_checkin_rows
for each row execute function public.sync_completed_checkin_to_inventory();

-- Seed inventory from check-ins completed before this migration.
insert into public.warehouse_inventory_lots (
  source_type, source_checkin_id, terminal, site_code, site_name, sub_location,
  received_date, mark, customer, bol_bc, original_bales, current_bales,
  warehouse_location, ecotton_receipt_status, source_notes
)
select
  'checkin', id, terminal, site_code, site_name,
  coalesce(nullif(trim(sub_location), ''), 'MAIN'), received_date,
  upper(trim(mark)), upper(trim(shipper)), bol_bc, bale_count, bale_count,
  nullif(upper(trim(coalesce(warehouse_location, ''))), ''),
  case when nullif(trim(coalesce(warehouse_location, '')), '') is null
    then 'not_ready' else 'pending' end,
  nullif(trim(concat_ws(E'\n', comment_1, comment_2)), '')
from public.inbound_checkin_rows
where draft_status in ('processed', 'outside_carrier')
  and nullif(trim(coalesce(mark, '')), '') is not null
  and nullif(trim(coalesce(shipper, '')), '') is not null
  and bale_count > 0
on conflict (source_checkin_id) do nothing;

insert into public.warehouse_inventory_events (
  inventory_lot_id, event_type, quantity_delta, to_mark, to_location,
  changed_by, note, after_values
)
select lot.id, 'receipt', lot.current_bales, lot.mark, lot.warehouse_location,
  'inventory migration', 'Inventory backfilled from completed inbound check-in',
  to_jsonb(lot)
from public.warehouse_inventory_lots lot
where lot.source_checkin_id is not null
  and not exists (
    select 1 from public.warehouse_inventory_events event
    where event.inventory_lot_id = lot.id and event.event_type = 'receipt'
  );

create or replace function public.update_warehouse_inventory_lot(
  p_id uuid,
  p_terminal text,
  p_site_code text,
  p_expected_updated_at timestamptz,
  p_current_bales integer,
  p_allocated_bales integer,
  p_missing_bales integer,
  p_warehouse_location text,
  p_booking_number text,
  p_inventory_status text,
  p_notes text,
  p_changed_by text default null
)
returns setof public.warehouse_inventory_lots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.warehouse_inventory_lots%rowtype;
  v_after public.warehouse_inventory_lots%rowtype;
  v_event_type text := 'update';
begin
  select * into v_before from public.warehouse_inventory_lots
  where id = p_id and terminal = upper(p_terminal) and site_code = p_site_code
  for update;

  if not found then raise exception 'Inventory lot not found'; end if;
  if v_before.updated_at <> p_expected_updated_at then
    raise exception 'Inventory changed in another browser. Reload and review it.';
  end if;
  if p_current_bales < 0 or p_allocated_bales < 0 or p_missing_bales < 0 then
    raise exception 'Bale quantities cannot be negative';
  end if;
  if p_allocated_bales > p_current_bales then
    raise exception 'Allocated bales cannot exceed current bales';
  end if;
  if p_inventory_status not in ('active', 'on_hold', 'closed') then
    raise exception 'Invalid inventory status';
  end if;

  update public.warehouse_inventory_lots
  set current_bales = p_current_bales,
      allocated_bales = p_allocated_bales,
      missing_bales = p_missing_bales,
      warehouse_location = nullif(upper(trim(coalesce(p_warehouse_location, ''))), ''),
      booking_number = nullif(upper(trim(coalesce(p_booking_number, ''))), ''),
      inventory_status = p_inventory_status,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_id
  returning * into v_after;

  if v_before.current_bales <> v_after.current_bales then
    v_event_type := 'adjustment';
  elsif v_before.allocated_bales <> v_after.allocated_bales
     or v_before.booking_number is distinct from v_after.booking_number then
    v_event_type := case when v_after.allocated_bales = 0 and v_after.booking_number is null
      then 'booking_release' else 'booking_allocation' end;
  elsif v_before.warehouse_location is distinct from v_after.warehouse_location then
    v_event_type := 'location_change';
  elsif v_before.inventory_status <> v_after.inventory_status then
    v_event_type := 'status_change';
  end if;

  if to_jsonb(v_before) - array['updated_at']::text[]
     is distinct from to_jsonb(v_after) - array['updated_at']::text[] then
    insert into public.warehouse_inventory_events (
      inventory_lot_id, event_type, quantity_delta, from_mark, to_mark,
      from_location, to_location, booking_number, changed_by, note,
      before_values, after_values
    ) values (
      v_after.id, v_event_type, v_after.current_bales - v_before.current_bales,
      v_before.mark, v_after.mark, v_before.warehouse_location,
      v_after.warehouse_location, v_after.booking_number,
      nullif(trim(coalesce(p_changed_by, '')), ''),
      case when v_event_type = 'adjustment' then 'Manual inventory quantity correction'
        else 'Inventory details updated' end,
      to_jsonb(v_before), to_jsonb(v_after)
    );
  end if;

  return next v_after;
end;
$$;

create or replace function public.warehouse_inventory_summary(
  p_terminal text,
  p_site_code text
)
returns table (
  total_lots bigint,
  current_bales bigint,
  allocated_bales bigint,
  available_bales bigint,
  missing_bales bigint,
  pending_receipts bigint
)
language sql
stable
security invoker
as $$
  select
    count(*) filter (where lot.inventory_status <> 'closed'),
    coalesce(sum(lot.current_bales) filter (where lot.inventory_status <> 'closed'), 0)::bigint,
    coalesce(sum(lot.allocated_bales) filter (where lot.inventory_status <> 'closed'), 0)::bigint,
    coalesce(sum(lot.current_bales - lot.allocated_bales) filter (where lot.inventory_status <> 'closed'), 0)::bigint,
    coalesce(sum(lot.missing_bales) filter (where lot.inventory_status <> 'closed'), 0)::bigint,
    count(*) filter (where lot.ecotton_receipt_status in ('pending', 'failed'))
  from public.warehouse_inventory_lots lot
  where lot.terminal = upper(p_terminal) and lot.site_code = p_site_code;
$$;
