-- Staff reconciles an SCM yard visit whose exact McLeod stop was already fully
-- completed. API validates live stop, direction, yard, customer/mark and actuals.
-- This transaction never updates McLeod. It is intentionally separate from
-- the outside-carrier (unresolved lookup) workflow.
begin;
create table public.inbound_mcleod_completed_events (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null unique references public.inbound_checkin_rows(id),
  order_id text not null, stop_id text not null,
  movement_direction text not null check (movement_direction in ('pickup','delivery')),
  material_type text not null check (material_type in ('cotton','lumber','other')),
  mcleod_arrival text not null, mcleod_departure text not null,
  actor_id uuid not null references public.scm_staff(id),
  actor_user_id uuid not null, actor_email text not null,
  reconciled_at timestamptz not null default now(),
  before_values jsonb not null, after_values jsonb not null,
  reason text not null default 'Exact McLeod stop already completed; SCM-only receiving/yard reconciliation; no McLeod write'
);
alter table public.inbound_mcleod_completed_events enable row level security;
revoke all on public.inbound_mcleod_completed_events from public,anon,authenticated,service_role;
grant select,insert on public.inbound_mcleod_completed_events to service_role;
create function public.guard_inbound_mcleod_completed_event()
returns trigger language plpgsql security invoker set search_path=public as $$
begin raise exception 'McLeod completed reconciliation audit is immutable'; end $$;
create trigger guard_inbound_mcleod_completed_event before update or delete on public.inbound_mcleod_completed_events
for each row execute function public.guard_inbound_mcleod_completed_event();

create function public.complete_inbound_mcleod_already_done(
  p_id uuid, p_terminal text, p_site_code text, p_expected_updated_at timestamptz,
  p_order_id text, p_stop_id text, p_staff_id uuid, p_user_id uuid,
  p_mcleod_arrival text, p_mcleod_departure text)
returns setof public.inbound_checkin_rows
language plpgsql security invoker set search_path=public as $$
declare
  actor public.scm_staff;
  existing public.inbound_checkin_rows;
  saved public.inbound_checkin_rows;
  prior public.inbound_mcleod_completed_events;
  at_time timestamptz := clock_timestamp();
begin
  if p_id is null or p_expected_updated_at is null or nullif(trim(p_order_id),'') is null or
     nullif(trim(p_stop_id),'') is null or nullif(trim(p_mcleod_arrival),'') is null or
     nullif(trim(p_mcleod_departure),'') is null then
    raise exception 'Complete verified McLeod stop evidence is required' using errcode='22023';
  end if;
  select * into actor from public.scm_staff where id=p_staff_id and user_id=p_user_id
    and status='active' and (role='admin' or (role='operator' and terminal=p_terminal)) for share;
  if not found then raise exception 'Active staff access for this terminal is required' using errcode='42501'; end if;
  select * into existing from public.inbound_checkin_rows
    where id=p_id and terminal=p_terminal and site_code=p_site_code for update;
  if not found then raise exception 'Arrival not found at this yard' using errcode='P0002'; end if;
  select * into prior from public.inbound_mcleod_completed_events where checkin_id=p_id;
  if found then
    if prior.order_id=p_order_id and prior.stop_id=p_stop_id and
       prior.actor_id=p_staff_id and prior.actor_user_id=p_user_id and
       existing.yard_status='completed' and
       (existing.material_type <> 'cotton' or existing.draft_status='processed') then
      return next existing; return;
    end if;
    raise exception 'Arrival already reconciled differently; review audit' using errcode='40001';
  end if;
  if existing.updated_at is distinct from p_expected_updated_at or
     existing.yard_status not in ('waiting','called','in_door','working') or
     existing.matched_order_id is distinct from p_order_id or
     (existing.matched_stop_id is not null and existing.matched_stop_id is distinct from p_stop_id) or
     existing.movement_direction not in ('pickup','delivery') or
     existing.material_type not in ('cotton','lumber','other') or
     existing.checked_in_at is null or
     existing.outside_carrier_override_at is not null or
     existing.mcleod_processing_phase in ('write_pending','legacy_processing','legacy_review') or
     existing.draft_status='processing' or
     (existing.material_type='cotton' and existing.movement_direction<>'delivery') then
    raise exception 'Arrival identity, pending McLeod write, or saved revision requires review' using errcode='40001';
  end if;
  if existing.material_type='cotton' then
    if existing.draft_status not in ('ready','failed','checked_in') or
       existing.bale_count is null or existing.bale_count <= 0 or
       existing.bol_bc is null or existing.bol_bc <= 0 or
       existing.bale_count < coalesce(existing.expected_bale_count,existing.bol_bc) or
       existing.received_date is null or
       nullif(trim(existing.mark),'') is null or nullif(trim(existing.shipper),'') is null or
       nullif(trim(existing.warehouse_location),'') is null or
       nullif(trim(existing.sub_location),'') is null or
       existing.equipment_type not in ('V','F') or existing.verified is distinct from true then
      raise exception 'Warehouse receiving details incomplete or bale shortage requires review' using errcode='22023';
    end if;
  end if;
  update public.inbound_checkin_rows set
    matched_stop_id=coalesce(matched_stop_id,p_stop_id),
    mcleod_lookup_has_known_match=true,
    mcleod_lookup_status='matched', mcleod_lookup_failure_code=null,
    mcleod_lookup_failed_at=null, mcleod_processing_phase='complete',
    processing_error=null,
    mcleod_processing_result_id=case when material_type='cotton' then mcleod_lookup_attempt_id else mcleod_processing_result_id end,
    draft_status=case when material_type='cotton' then 'processed' else draft_status end,
    processed_at=case when material_type='cotton' then at_time else processed_at end,
    checkin_completed_at=coalesce(checkin_completed_at,at_time),
    yard_status='completed', yard_completed_at=coalesce(yard_completed_at,at_time),
    yard_updated_by=actor.email || ' [' || actor.user_id::text || ']'
    where id=p_id returning * into saved;
  insert into public.inbound_mcleod_completed_events(
    checkin_id,order_id,stop_id,movement_direction,material_type,
    mcleod_arrival,mcleod_departure,actor_id,actor_user_id,actor_email,
    reconciled_at,before_values,after_values)
  values(p_id,p_order_id,p_stop_id,existing.movement_direction,existing.material_type,
    p_mcleod_arrival,p_mcleod_departure,actor.id,actor.user_id,actor.email,
    at_time,to_jsonb(existing),to_jsonb(saved));
  return next saved;
end $$;
revoke all on function public.complete_inbound_mcleod_already_done(uuid,text,text,timestamptz,text,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_inbound_mcleod_already_done(uuid,text,text,timestamptz,text,text,uuid,uuid,text,text) to service_role;
commit;
