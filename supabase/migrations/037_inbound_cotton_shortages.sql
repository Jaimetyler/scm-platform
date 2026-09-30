-- Cotton shortage receiving is distinct from a McLeod delivery.
alter table public.inbound_checkin_rows
  add column if not exists expected_bale_count integer check (expected_bale_count > 0),
  add column if not exists driver_reported_bales integer check (driver_reported_bales >= 0),
  add column if not exists shortage_acknowledged_at timestamptz,
  add column if not exists shortage_acknowledged_by text,
  add column if not exists shortage_expected_bales integer,
  add column if not exists shortage_received_bales integer,
  add column if not exists shortage_note text,
  add column if not exists customer_notified_at timestamptz,
  add column if not exists customer_notified_by text,
  add column if not exists checkin_completed_at timestamptz;

alter table public.inbound_checkin_rows drop constraint if exists inbound_checkin_rows_draft_status_check;
alter table public.inbound_checkin_rows add constraint inbound_checkin_rows_draft_status_check
  check (draft_status in ('draft','checked_in','ready','processing','processed','outside_carrier','failed','delivery_blocked'));

create table if not exists public.inbound_shortage_events (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.inbound_checkin_rows(id),
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('acknowledged','customer_notified','counts_changed')),
  expected_bales integer,
  received_bales integer,
  changed_by text not null,
  note text not null
);
alter table public.inbound_shortage_events enable row level security;
revoke all on public.inbound_shortage_events from anon, authenticated;
grant select, insert on public.inbound_shortage_events to service_role;

create or replace function public.guard_inbound_shortage()
returns trigger language plpgsql as $$
declare
  v_expected integer;
  v_received integer;
  v_short boolean;
  v_ack boolean;
begin
  v_expected := coalesce(new.expected_bale_count, new.bol_bc);
  v_received := coalesce(new.bale_count, new.driver_reported_bales,
    case when new.expected_bale_count is not null then new.bol_bc end);
  v_short := new.material_type = 'cotton' and new.movement_direction = 'delivery'
    and v_expected > 0 and v_received >= 0 and v_received < v_expected;
  v_ack := coalesce(v_short and new.shortage_acknowledged_at is not null
    and nullif(trim(new.shortage_note), '') is not null
    and new.shortage_expected_bales = v_expected
    and new.shortage_received_bales = v_received, false);
  if not v_ack then
    new.shortage_acknowledged_at := null;
    new.shortage_acknowledged_by := null;
    new.shortage_expected_bales := null;
    new.shortage_received_bales := null;
    new.shortage_note := null;
    new.customer_notified_at := null;
    new.customer_notified_by := null;
  end if;
  if v_short and new.draft_status in ('ready','processing','processed','outside_carrier') then
    -- Historical corrections do not undo an already-posted delivery.
    if tg_op = 'INSERT' or old.draft_status not in ('processed','outside_carrier') then
      raise exception 'Bale shortage: cannot post McLeod delivery';
    end if;
  end if;
  if new.draft_status = 'delivery_blocked' then
    if not v_ack or new.bale_count is null or new.bale_count <= 0
       or new.received_date is null or new.bol_bc is null or new.bol_bc <= 0
       or nullif(trim(new.mark), '') is null or nullif(trim(new.shipper), '') is null
       or nullif(trim(new.warehouse_location), '') is null
       or nullif(trim(new.sub_location), '') is null or new.equipment_type is null then
      raise exception 'Complete receiving details and acknowledge the current shortage first';
    end if;
    new.checkin_completed_at := coalesce(new.checkin_completed_at, now());
    new.processed_at := null;
    new.processing_error := 'Bale shortage: McLeod delivery cannot be posted. Notify the customer and record follow-up in Notes.';
  end if;
  if tg_op = 'UPDATE' and old.draft_status = 'delivery_blocked' and new.draft_status <> 'delivery_blocked' then
    raise exception 'Shortage receiving is complete; the McLeod delivery remains blocked';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_inbound_shortage on public.inbound_checkin_rows;
create trigger trg_guard_inbound_shortage before insert or update on public.inbound_checkin_rows
for each row execute function public.guard_inbound_shortage();

create or replace function public.audit_inbound_shortage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shortage_acknowledged_at is not null and
    (tg_op = 'INSERT' or old.shortage_acknowledged_at is distinct from new.shortage_acknowledged_at) then
    insert into inbound_shortage_events(checkin_id,event_type,expected_bales,received_bales,changed_by,note)
    values(new.id,'acknowledged',new.shortage_expected_bales,new.shortage_received_bales,
      coalesce(new.shortage_acknowledged_by,'warehouse staff'),new.shortage_note);
  end if;
  if tg_op = 'UPDATE' and old.shortage_acknowledged_at is not null and new.shortage_acknowledged_at is null then
    insert into inbound_shortage_events(checkin_id,event_type,expected_bales,received_bales,changed_by,note)
    values(new.id,'counts_changed',old.shortage_expected_bales,old.shortage_received_bales,
      'check-in workflow','Previous shortage acknowledgement invalidated by changed counts');
  end if;
  if new.customer_notified_at is not null and
    (tg_op = 'INSERT' or old.customer_notified_at is distinct from new.customer_notified_at) then
    insert into inbound_shortage_events(checkin_id,event_type,expected_bales,received_bales,changed_by,note)
    values(new.id,'customer_notified',new.shortage_expected_bales,new.shortage_received_bales,
      coalesce(new.customer_notified_by,'warehouse staff'),concat_ws(E'\n',new.comment_1,new.comment_2));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_audit_inbound_shortage on public.inbound_checkin_rows;
create trigger trg_audit_inbound_shortage after insert or update on public.inbound_checkin_rows
for each row execute function public.audit_inbound_shortage();

create or replace function public.claim_inbound_checkin_row(p_id uuid)
returns setof public.inbound_checkin_rows language plpgsql security invoker as $$
begin
  return query update public.inbound_checkin_rows
    set draft_status='processing', processing_error=null
    where id=p_id and draft_status='ready' and movement_direction='delivery' and material_type='cotton'
      and bale_count >= coalesce(expected_bale_count,bol_bc)
    returning *;
end;
$$;

-- The receipt contains only the bales physically unloaded. A shortage is not
-- inventory that went missing after receipt and does not populate missing_bales.
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
  if new.draft_status not in ('processed', 'outside_carrier', 'delivery_blocked') then
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

