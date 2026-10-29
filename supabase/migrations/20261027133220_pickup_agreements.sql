-- Additive; historical and staff check-ins are not retroactively marked signed.
alter table public.inbound_checkin_rows add column pickup_agreement jsonb;
-- The table is service-only, with RLS enabled; do not expose signature snapshots
-- through anon/authenticated table grants or normal grid serializers.
create function public.protect_pickup_agreement() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if TG_OP = 'DELETE' then
    if old.pickup_agreement is not null then raise exception 'Signed pickup agreements must be retained' using errcode='23514'; end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' then
    if new.pickup_agreement is distinct from old.pickup_agreement then
      raise exception 'Pickup agreement snapshots cannot be changed' using errcode='23514';
    end if;
    return new;
  end if;
  if new.pickup_agreement is not null then
    if new.movement_direction is distinct from 'pickup' or new.checkin_source is distinct from 'driver_qr'
      or jsonb_typeof(new.pickup_agreement) is distinct from 'object'
      or (new.pickup_agreement->>'version') is distinct from 'scm-pickup-2026-10-27-v1'
      or coalesce(new.pickup_agreement->>'language','') not in ('en','es')
      or (new.pickup_agreement->>'acknowledged') is distinct from 'true'
      or (new.pickup_agreement->>'electronicConsent') is distinct from 'true'
      or length(coalesce(new.pickup_agreement->>'printedName','')) = 0
      or jsonb_typeof(new.pickup_agreement->'terms') is distinct from 'object'
      or jsonb_typeof(new.pickup_agreement->'strokes') is distinct from 'array'
      or octet_length(new.pickup_agreement::text) > 250000 then
      raise exception 'Invalid pickup agreement snapshot' using errcode='23514';
    end if;
    -- Stamp authoritative database time; never trust a browser-supplied timestamp.
    new.pickup_agreement = jsonb_set(new.pickup_agreement, '{acceptedAt}', to_jsonb(clock_timestamp()));
  end if;
  return new;
end;
$$;
revoke all on function public.protect_pickup_agreement() from public, anon, authenticated;
create trigger protect_pickup_agreement before insert or update or delete on public.inbound_checkin_rows
for each row execute function public.protect_pickup_agreement();
