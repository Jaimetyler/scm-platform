-- Preserve the existing receipt/correction workflow, adding explicit local-only cotton completion.
begin;
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
  -- A physical local-only cotton receipt is complete without a McLeod status.
  -- Never create cotton inventory for completed lumber/other movements.
  if new.material_type <> 'cotton' or new.movement_direction <> 'delivery' then
    return new;
  end if;
  if new.draft_status not in ('processed', 'outside_carrier', 'delivery_blocked') and not (
    new.local_receiving_only and new.yard_status='completed' and
    new.physical_departed_at is not null and new.verified and
    new.received_date is not null and new.bol_bc > 0 and
    nullif(trim(new.warehouse_location),'') is not null and new.equipment_type in ('V','F')
  ) then
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

drop trigger if exists trg_sync_completed_checkin_to_inventory on public.inbound_checkin_rows;
create trigger trg_sync_completed_checkin_to_inventory
  after insert or update of draft_status, received_date, mark, shipper, bol_bc,
    bale_count, warehouse_location, sub_location, comment_1, comment_2,
    yard_status, physical_departed_at, local_receiving_only
  on public.inbound_checkin_rows
  for each row execute function public.sync_completed_checkin_to_inventory();
commit;
