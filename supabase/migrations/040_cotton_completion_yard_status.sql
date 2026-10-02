-- Keep a successfully processed SCM cotton delivery in sync with the yard.
-- No McLeod calls; existing completed/cancelled rows and timestamps are preserved.
begin;
create or replace function public.complete_processed_cotton_yard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.material_type = 'cotton' and new.movement_direction = 'delivery'
     and new.draft_status = 'processed' and new.matched_order_id is not null
     and new.processed_at is not null
     and new.yard_status in ('waiting','called','in_door','working') then
    new.yard_status := 'completed';
    new.yard_completed_at := coalesce(new.yard_completed_at, new.verified_at, new.processed_at);
  end if;
  return new;
end $$;
drop trigger if exists complete_processed_cotton_yard on public.inbound_checkin_rows;
create trigger complete_processed_cotton_yard before insert or update on public.inbound_checkin_rows
for each row execute function public.complete_processed_cotton_yard();

-- Repair the same condition in existing rows; never re-post their deliveries.
update public.inbound_checkin_rows set yard_status = 'completed',
  yard_completed_at = coalesce(yard_completed_at, verified_at, processed_at)
where material_type = 'cotton' and movement_direction = 'delivery'
  and draft_status = 'processed' and matched_order_id is not null and processed_at is not null
  and yard_status in ('waiting','called','in_door','working');
commit;
