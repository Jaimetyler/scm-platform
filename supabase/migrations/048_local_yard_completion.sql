-- Local yard departure is independent of McLeod processing. Preserve
-- existing audit and write-pending safeguards; never modify remote actuals.
begin;

create table if not exists public.inbound_yard_completion_events (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.inbound_checkin_rows(id),
  completed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  actor text not null,
  previous_status text not null,
  mcleod_status text not null,
  unique(checkin_id)
);
revoke all on public.inbound_yard_completion_events from public, anon, authenticated;
grant select, insert on public.inbound_yard_completion_events to service_role;

create function public.complete_inbound_yard_local(
  p_id uuid, p_terminal text, p_site_code text,
  p_expected_updated_at timestamptz, p_actor text,
  p_departed_at timestamptz default null)
returns setof public.inbound_checkin_rows
language plpgsql security invoker set search_path=public as $$
declare
  existing public.inbound_checkin_rows;
  saved public.inbound_checkin_rows;
  departed timestamptz := coalesce(p_departed_at, clock_timestamp());
begin
  if nullif(trim(p_actor),'') is null or p_expected_updated_at is null then
    raise exception 'Actor and current row revision required' using errcode='22023';
  end if;
  select * into existing from public.inbound_checkin_rows
    where id=p_id and terminal=p_terminal and site_code=p_site_code for update;
  if not found then raise exception 'Arrival not found' using errcode='P0002'; end if;
  if existing.yard_status='completed' then
    return next existing;
    return;
  end if;
  if existing.updated_at is distinct from p_expected_updated_at or
     existing.yard_status not in ('waiting','called','in_door','working') or
     existing.checked_in_at is null or departed < existing.checked_in_at or
     departed > clock_timestamp() + interval '5 minutes' then
    raise exception 'Arrival changed or departure time invalid' using errcode='40001';
  end if;
  -- An uncertain remote write must be explicitly reconciled first.
  if existing.mcleod_processing_phase='write_pending' then
    raise exception 'Uncertain McLeod write requires reconciliation' using errcode='40001';
  end if;
  update public.inbound_checkin_rows
    set yard_status='completed', yard_completed_at=departed, yard_updated_by=p_actor
    where id=p_id returning * into saved;
  insert into public.inbound_yard_completion_events
    (checkin_id, completed_at, actor, previous_status, mcleod_status)
    values(p_id, departed, p_actor, existing.yard_status,
      coalesce(existing.mcleod_lookup_status,'pending'));
  return next saved;
end $$;
revoke all on function public.complete_inbound_yard_local(uuid,text,text,timestamptz,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_inbound_yard_local(uuid,text,text,timestamptz,text,timestamptz)
  to service_role;
commit;
