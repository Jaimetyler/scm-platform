-- Keep recent Houston domestic references protected across dates and freight categories.
create or replace function public.prevent_duplicate_freight_checkin()
returns trigger
language plpgsql
as $$
declare
  reference_key text;
  candidate_key text;
  houston_domestic boolean;
begin
  if tg_op = 'INSERT' and new.draft_status <> 'checked_in' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.matched_order_id is not distinct from old.matched_order_id then
    return new;
  end if;

  reference_key := upper(btrim(coalesce(
    case when new.material_type = 'cotton' then new.mark else new.reference_number end, ''
  )));
  houston_domestic := new.terminal = 'HOU' and new.material_type in ('lumber', 'other');
  -- Lock the reference and order keys in a stable order. A linked and an
  -- unlinked submission for the same reference must also serialize.
  for candidate_key in
    select key from unnest(array[
      concat_ws('|', new.terminal, new.site_code, new.movement_direction,
        case when houston_domestic then 'DOMESTIC-REF:' || reference_key
          else 'REF:' || new.material_type || ':' || reference_key || ':' || coalesce(new.received_date::text, '') end),
      case when nullif(btrim(new.matched_order_id), '') is not null then
        concat_ws('|', new.terminal, new.site_code, new.movement_direction,
          'ORDER:' || upper(btrim(new.matched_order_id)))
      end
    ]) as locks(key) where key is not null order by key
  loop
    perform pg_advisory_xact_lock(hashtextextended(candidate_key, 0));
  end loop;

  if nullif(btrim(new.matched_order_id), '') is not null and exists (
    select 1 from public.inbound_checkin_rows prior
    where prior.id <> new.id and prior.terminal = new.terminal and prior.site_code = new.site_code
      and prior.movement_direction = new.movement_direction
      and upper(btrim(prior.matched_order_id)) = upper(btrim(new.matched_order_id))
      and prior.yard_status is distinct from 'cancelled'
  ) then
    raise exception using errcode = '23505',
      message = 'This SCM order is already checked in or has already left this yard.';
  end if;

  if reference_key <> '' and exists (
    select 1 from public.inbound_checkin_rows prior
    where prior.id <> new.id and prior.terminal = new.terminal and prior.site_code = new.site_code
      and prior.movement_direction = new.movement_direction
      and (
        (not houston_domestic and prior.material_type = new.material_type and prior.received_date = new.received_date)
        or (houston_domestic and prior.material_type in ('lumber', 'other') and (
          prior.received_date = new.received_date
          or prior.checked_in_at is not null and (
            prior.yard_status in ('waiting', 'called', 'in_door', 'working')
            or greatest(prior.physical_departed_at, prior.yard_completed_at, prior.checked_in_at)
              >= coalesce(new.checked_in_at, now()) - interval '48 hours'
          )
        ))
      )
      and upper(btrim(coalesce(
        case when prior.material_type = 'cotton' then prior.mark else prior.reference_number end, ''
      ))) = reference_key
      and (new.material_type <> 'cotton' or prior.bol_bc is not distinct from new.bol_bc)
      and (prior.matched_order_id is null or new.matched_order_id is null
        or upper(btrim(prior.matched_order_id)) = upper(btrim(new.matched_order_id)))
      and prior.yard_status is distinct from 'cancelled'
  ) then
    raise exception using errcode = '23505',
      message = case when houston_domestic then
        'This pickup or delivery reference is already in this yard’s check-in history. Please see warehouse staff.'
      else 'This reference is already checked in at this yard today.' end;
  end if;

  return new;
end;
$$;

