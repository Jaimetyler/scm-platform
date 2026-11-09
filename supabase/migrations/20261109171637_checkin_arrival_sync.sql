begin;
create table public.inbound_arrival_sync (
  checkin_id uuid primary key references public.inbound_checkin_rows(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','writing','synced','review')),
  snapshot jsonb,
  error text,
  attempted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.inbound_arrival_sync enable row level security;
revoke all on public.inbound_arrival_sync from public, anon, authenticated;
grant select, insert, update on public.inbound_arrival_sync to service_role;

-- Queue new arrivals atomically with the local save. No historical backfill.
create function public.enqueue_inbound_arrival() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.checked_in_at is not null and new.yard_status in ('waiting','called','in_door','working')
      and new.material_type in ('cotton','lumber','other') then
    insert into public.inbound_arrival_sync(checkin_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.enqueue_inbound_arrival() from public, anon, authenticated;
create trigger enqueue_inbound_arrival after insert or update of checked_in_at, matched_order_id, matched_stop_id
on public.inbound_checkin_rows for each row execute function public.enqueue_inbound_arrival();

-- Serialize the arrival claim against edits and checkout on the same saved row.
create function public.claim_inbound_arrival(p_id uuid, p_revision timestamptz, p_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare r public.inbound_checkin_rows; claimed uuid;
begin
  select * into r from public.inbound_checkin_rows where id=p_id for update;
  if not found or r.updated_at is distinct from p_revision or r.checked_in_at is null
      or r.matched_order_id is null or r.local_receiving_only or r.outside_carrier_override_at is not null
      or r.yard_status not in ('waiting','called','in_door','working') or r.physical_departed_at is not null
      or r.mcleod_processing_phase='write_pending' then return false; end if;
  update public.inbound_arrival_sync set status='writing', snapshot=p_snapshot, attempted_at=now(), error=null
    where checkin_id=p_id and status='pending' returning checkin_id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_inbound_arrival(uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.claim_inbound_arrival(uuid,timestamptz,jsonb) to service_role;

create function public.guard_inbound_arrival_identity() returns trigger
language plpgsql security definer set search_path=public as $$
declare phase text;
begin
  select status into phase from public.inbound_arrival_sync where checkin_id=old.id;
  if phase in ('writing','synced','review') and
      row(new.checked_in_at,new.matched_order_id,new.terminal,new.site_code,new.site_name,new.movement_direction,new.material_type,new.reference_number,new.mark)
      is distinct from row(old.checked_in_at,old.matched_order_id,old.terminal,old.site_code,old.site_name,old.movement_direction,old.material_type,old.reference_number,old.mark) then
    raise exception 'Arrival already sent or awaiting McLeod review; its order, yard, reference and check-in time cannot be changed.' using errcode='40001';
  end if;
  if phase in ('writing','synced','review') and new.matched_stop_id is distinct from old.matched_stop_id
      and (new.matched_stop_id is null or new.matched_stop_id is distinct from
        (select snapshot->>'stopId' from public.inbound_arrival_sync where checkin_id=old.id)) then
    raise exception 'The arrival belongs to a different stop; office review required.' using errcode='40001';
  end if;
  if phase='writing' and (new.physical_departed_at is distinct from old.physical_departed_at or new.yard_status in ('completed','cancelled') or new.mcleod_processing_phase='write_pending') then
    raise exception 'Arrival update is awaiting confirmation. Check arrival status before checkout.' using errcode='40001';
  end if;
  return new;
end $$;
revoke all on function public.guard_inbound_arrival_identity() from public,anon,authenticated;
create trigger guard_inbound_arrival_identity before update on public.inbound_checkin_rows
for each row execute function public.guard_inbound_arrival_identity();
commit;
