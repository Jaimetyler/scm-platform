-- Prepare only. Apply through the approved release process before deploying callers.
-- A typed, persisted read-only lookup failure is distinct from an ambiguous write.
begin;
alter table public.inbound_checkin_rows
  add column mcleod_lookup_attempt_id uuid,
  add column mcleod_processing_result_id uuid,
  add column mcleod_lookup_status text check (mcleod_lookup_status in ('pending','searching','unresolved','matched','no_match','conflict','error')),
  add column mcleod_lookup_failure_code text,
  add column mcleod_lookup_failed_at timestamptz,
  add column mcleod_lookup_has_known_match boolean not null default false,
  add column mcleod_processing_phase text check (mcleod_processing_phase in ('lookup','matched','write_pending','complete','legacy_processing','legacy_review')),
  add column outside_carrier_override_request_id uuid unique,
  add column outside_carrier_override_at timestamptz,
  add column outside_carrier_override_by text,
  add column outside_carrier_override_reason text;

create table public.inbound_outside_carrier_events (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null unique references public.inbound_checkin_rows(id),
  request_id uuid not null unique,
  lookup_attempt_id uuid not null,
  actor_id uuid not null references public.scm_staff(id),
  actor_user_id uuid not null,
  actor_email text not null,
  created_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) between 5 and 500),
  acknowledgement text not null,
  verification_status text not null check (verification_status = 'unresolved'),
  lookup_failure_code text not null,
  lookup_failed_at timestamptz not null,
  before_values jsonb not null,
  after_values jsonb not null
);
alter table public.inbound_outside_carrier_events enable row level security;
revoke all on public.inbound_outside_carrier_events from public, anon, authenticated, service_role;
grant select, insert on public.inbound_outside_carrier_events to service_role;

create function public.guard_outside_carrier_audit()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  raise exception 'Outside-carrier audit events are immutable';
end $$;
create trigger guard_outside_carrier_audit before update or delete on public.inbound_outside_carrier_events
for each row execute function public.guard_outside_carrier_audit();
revoke all on function public.guard_outside_carrier_audit() from public,anon,authenticated;
grant execute on function public.guard_outside_carrier_audit() to service_role;

-- Seed legacy links before callers may change those identity fields.
update public.inbound_checkin_rows set mcleod_lookup_has_known_match=true
where matched_order_id is not null or matched_stop_id is not null;

-- Never re-open a manual completion or discard its unresolved audit. Known match
-- evidence is sticky, including a candidate seen during an incomplete search.
create function public.guard_manual_outside_carrier()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  -- Old application claims retain their own provenance. They may finish normally,
  -- but cannot consume or settle a v2 attempt after an application rollback.
  if old.draft_status='ready' and new.draft_status='processing' and
     new.mcleod_lookup_attempt_id is not distinct from old.mcleod_lookup_attempt_id then
    if old.mcleod_lookup_attempt_id is not null or old.mcleod_processing_phase='lookup' then
      raise exception 'This check-in requires the versioned lookup workflow';
    end if;
    new.mcleod_processing_phase := 'legacy_processing';
  end if;
  if old.draft_status='processing' and new.draft_status in ('failed','processed','outside_carrier') then
    if old.mcleod_lookup_attempt_id is not null and new.mcleod_processing_result_id is distinct from old.mcleod_lookup_attempt_id then
      raise exception 'Only the current versioned attempt may settle this check-in';
    elsif old.mcleod_lookup_attempt_id is null and new.draft_status='failed' then
      new.mcleod_processing_phase := 'legacy_review';
    end if;
  end if;
  if old.draft_status='failed' and old.mcleod_lookup_attempt_id is null and
     new.mcleod_processing_phase is distinct from 'lookup' then
    if old.processing_error='McLeod search incomplete (result limit reached); cannot classify outside carrier. Review McLeod search logs.' and
       old.matched_order_id is null and old.matched_stop_id is null and not old.mcleod_lookup_has_known_match then
      new.mcleod_processing_phase := 'lookup';
    else
      new.mcleod_processing_phase := 'legacy_review';
    end if;
  end if;
  if new.mcleod_processing_phase='lookup' and old.mcleod_processing_phase is distinct from 'lookup' and
     ((old.draft_status='failed' and old.mcleod_lookup_attempt_id is null) or
       old.mcleod_processing_phase in ('legacy_processing','legacy_review')) and not (
     old.draft_status='failed' and old.processing_error=
       'McLeod search incomplete (result limit reached); cannot classify outside carrier. Review McLeod search logs.' and
     old.matched_order_id is null and old.matched_stop_id is null and not old.mcleod_lookup_has_known_match) then
    raise exception 'Legacy processing outcome is uncertain; reconcile it before retrying';
  end if;
  if (old.matched_order_id is not null and new.matched_order_id is distinct from old.matched_order_id) or
     (old.matched_stop_id is not null and new.matched_stop_id is distinct from old.matched_stop_id) then
    raise exception 'An established McLeod order or stop requires explicit reconciliation before replacement';
  end if;
  if old.matched_order_id is not null or old.matched_stop_id is not null or
     new.matched_order_id is not null or new.matched_stop_id is not null then
    new.mcleod_lookup_has_known_match := true;
  end if;
  if old.mcleod_lookup_has_known_match and not new.mcleod_lookup_has_known_match then
    raise exception 'Known McLeod match evidence cannot be discarded';
  end if;
  if old.mcleod_processing_phase = 'write_pending' and
     (new.mcleod_processing_phase is distinct from old.mcleod_processing_phase
       and not (new.mcleod_processing_phase = 'complete' and new.draft_status = 'processed')) then
    raise exception 'An uncertain McLeod write requires reconciliation';
  end if;
  if old.draft_status='processing' and new.yard_status is distinct from old.yard_status and not
     (new.draft_status in ('processed','outside_carrier') and new.yard_status='completed' and
       new.mcleod_processing_result_id=old.mcleod_lookup_attempt_id) then
    raise exception 'An active processing attempt cannot be removed from the yard';
  end if;
  if old.mcleod_processing_phase='write_pending' and new.yard_status is distinct from old.yard_status and not
     (new.draft_status='processed' and new.mcleod_processing_phase='complete' and new.yard_status='completed') then
    raise exception 'An uncertain McLeod write requires reconciliation before changing yard status';
  end if;
  if old.mcleod_processing_phase = 'write_pending' and (
     new.draft_status not in ('processing','failed','processed') or
     (to_jsonb(new) - array['updated_at','last_saved_at','draft_status','processed_at','processing_error',
       'mcleod_lookup_status','mcleod_processing_phase','mcleod_processing_result_id','yard_status','yard_completed_at','comment_1','comment_2']::text[])
     is distinct from
     (to_jsonb(old) - array['updated_at','last_saved_at','draft_status','processed_at','processing_error',
       'mcleod_lookup_status','mcleod_processing_phase','mcleod_processing_result_id','yard_status','yard_completed_at','comment_1','comment_2']::text[])) then
    raise exception 'An uncertain McLeod write requires reconciliation before changing receiving details';
  end if;
  if old.outside_carrier_override_at is null and old.mcleod_lookup_status in ('unresolved','conflict') and
     (row(new.terminal,new.site_code,new.received_date,new.mark,new.shipper,new.bol_bc,new.bale_count,
       new.expected_bale_count,new.warehouse_location,new.equipment_type,new.matched_order_id,new.matched_stop_id)
      is distinct from row(old.terminal,old.site_code,old.received_date,old.mark,old.shipper,old.bol_bc,old.bale_count,
       old.expected_bale_count,old.warehouse_location,old.equipment_type,old.matched_order_id,old.matched_stop_id)) then
    new.mcleod_lookup_status := null;
    new.mcleod_lookup_attempt_id := null;
    new.mcleod_lookup_failure_code := null;
    new.mcleod_lookup_failed_at := null;
  end if;
  if old.outside_carrier_override_at is not null and (
     new.outside_carrier_override_request_id is distinct from old.outside_carrier_override_request_id or
     new.outside_carrier_override_at is distinct from old.outside_carrier_override_at or
     new.outside_carrier_override_by is distinct from old.outside_carrier_override_by or
     new.outside_carrier_override_reason is distinct from old.outside_carrier_override_reason or
     new.mcleod_lookup_attempt_id is distinct from old.mcleod_lookup_attempt_id or
     new.mcleod_lookup_status is distinct from old.mcleod_lookup_status or
     new.mcleod_lookup_failure_code is distinct from old.mcleod_lookup_failure_code or
     new.mcleod_lookup_failed_at is distinct from old.mcleod_lookup_failed_at or
     new.mcleod_processing_phase is distinct from old.mcleod_processing_phase or
     new.draft_status is distinct from old.draft_status or
     new.yard_status is distinct from old.yard_status or
     new.yard_completed_at is distinct from old.yard_completed_at or
     new.processed_at is distinct from old.processed_at or
     new.matched_order_id is distinct from old.matched_order_id or
     new.matched_stop_id is distinct from old.matched_stop_id) then
    raise exception 'Manual outside-carrier completion requires separate reconciliation; automatic McLeod processing is blocked';
  end if;
  return new;
end $$;
create trigger guard_manual_outside_carrier before update on public.inbound_checkin_rows
for each row execute function public.guard_manual_outside_carrier();

create function public.claim_inbound_checkin_row_v2(p_id uuid)
returns setof public.inbound_checkin_rows language plpgsql security invoker set search_path=public as $$
begin
  return query update public.inbound_checkin_rows
    set draft_status='processing', processing_error=null,
      mcleod_lookup_attempt_id=gen_random_uuid(), mcleod_processing_result_id=null, mcleod_lookup_status='pending',
      mcleod_lookup_failure_code=null, mcleod_lookup_failed_at=null,
      mcleod_processing_phase='lookup'
    where id=p_id and draft_status='ready' and movement_direction='delivery' and material_type='cotton'
      and bale_count >= coalesce(expected_bale_count,bol_bc)
      and outside_carrier_override_at is null
      and mcleod_processing_phase='lookup'
    returning *;
end $$;

-- Explicit recovery may fence an interrupted read-only lookup. An old worker
-- cannot progress because every subsequent phase transition checks its attempt.
create function public.retry_inbound_checkin_lookup(p_id uuid, p_terminal text, p_site_code text,
  p_expected_updated_at timestamptz, p_staff_id uuid, p_user_id uuid)
returns setof public.inbound_checkin_rows
language plpgsql security invoker set search_path=public as $$
begin
  perform 1 from public.scm_staff where id=p_staff_id and user_id=p_user_id
    and status='active' and (role='admin' or (role='operator' and terminal=p_terminal)) for share;
  if not found then raise exception 'Active staff access for this yard is required' using errcode='42501'; end if;
  return query update public.inbound_checkin_rows
    set mcleod_lookup_attempt_id=gen_random_uuid(), mcleod_processing_result_id=null, mcleod_lookup_status='pending',
      mcleod_lookup_failure_code=null, mcleod_lookup_failed_at=null, processing_error=null
    where id=p_id and terminal=p_terminal and site_code=p_site_code
      and updated_at=p_expected_updated_at and draft_status='processing'
      and mcleod_processing_phase='lookup' and mcleod_lookup_status in ('pending','searching','unresolved','conflict','error')
      and mcleod_lookup_attempt_id is not null and outside_carrier_override_at is null
      and material_type='cotton' and movement_direction='delivery'
    returning *;
  if not found then raise exception 'This lookup changed or may have started a McLeod write. Refresh and review it' using errcode='40001'; end if;
end $$;
revoke all on function public.retry_inbound_checkin_lookup(uuid,text,text,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_inbound_checkin_lookup(uuid,text,text,timestamptz,uuid,uuid) to service_role;

-- Proven no-match completion also closes the yard in the receiving transaction.
create or replace function public.complete_processed_cotton_yard()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.material_type='cotton' and new.movement_direction='delivery'
     and ((new.draft_status='processed' and new.matched_order_id is not null)
       or (new.draft_status='outside_carrier' and new.mcleod_lookup_status='no_match'
         and new.mcleod_processing_phase='complete' and new.matched_order_id is null
         and new.matched_stop_id is null and not new.mcleod_lookup_has_known_match))
     and new.processed_at is not null and new.yard_status in ('waiting','called','in_door','working') then
    new.yard_status := 'completed';
    new.yard_completed_at := coalesce(new.yard_completed_at,new.verified_at,new.processed_at);
  end if;
  return new;
end $$;

-- Server-only RPC. Recheck the authenticated staff account against the database,
-- then lock the row so retry/checkout/manual-completion cannot win concurrently.
create function public.complete_inbound_outside_carrier(
  p_id uuid, p_terminal text, p_site_code text, p_expected_updated_at timestamptz,
  p_lookup_attempt_id uuid, p_request_id uuid, p_staff_id uuid, p_user_id uuid,
  p_acknowledge_unresolved boolean, p_reason text)
returns setof public.inbound_checkin_rows
language plpgsql security invoker set search_path=public as $$
declare
  actor public.scm_staff;
  existing public.inbound_checkin_rows;
  saved public.inbound_checkin_rows;
  previous public.inbound_outside_carrier_events;
  at_time timestamptz := clock_timestamp();
begin
  if p_acknowledge_unresolved is distinct from true or p_request_id is null or
     p_lookup_attempt_id is null or p_expected_updated_at is null or
     p_reason is null or length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Acknowledge unresolved McLeod verification and provide a reason (5-500 characters)' using errcode='22023';
  end if;
  select * into actor from public.scm_staff where id=p_staff_id and user_id=p_user_id
    and status='active' and (role='admin' or (role='operator' and terminal=p_terminal)) for share;
  if not found then raise exception 'Active staff access for this yard is required' using errcode='42501'; end if;
  select * into existing from public.inbound_checkin_rows
    where id=p_id and terminal=p_terminal and site_code=p_site_code for update;
  if not found then raise exception 'Check-in not found' using errcode='P0002'; end if;
  select * into previous from public.inbound_outside_carrier_events where checkin_id=p_id;
  if found then
    if previous.request_id=p_request_id and previous.lookup_attempt_id=p_lookup_attempt_id and
       previous.actor_id=p_staff_id and previous.actor_user_id=p_user_id and previous.reason=trim(p_reason) and
       existing.outside_carrier_override_request_id=p_request_id and
       existing.draft_status='outside_carrier' and existing.yard_status='completed' then
      return next existing;
      return;
    end if;
    raise exception 'This arrival has already been completed; refresh the line' using errcode='40001';
  end if;
  if existing.updated_at is distinct from p_expected_updated_at or
     existing.mcleod_lookup_attempt_id is distinct from p_lookup_attempt_id then
    raise exception 'This arrival changed. Retry the search or refresh before confirming' using errcode='40001';
  end if;
  if existing.draft_status is distinct from 'failed' or
     existing.material_type is distinct from 'cotton' or existing.movement_direction is distinct from 'delivery' or
     existing.yard_status is null or existing.yard_status not in ('waiting','called','in_door','working') or
     existing.checked_in_at is null or existing.matched_order_id is not null or existing.matched_stop_id is not null or
     existing.mcleod_lookup_has_known_match or existing.outside_carrier_override_at is not null or
     existing.mcleod_processing_phase is distinct from 'lookup' or
     existing.mcleod_lookup_status is distinct from 'unresolved' or existing.mcleod_lookup_failed_at is null or
     existing.mcleod_lookup_failure_code is null or existing.mcleod_lookup_failure_code not in ('SEARCH_LIMIT_REACHED','LOOKUP_UNAVAILABLE','LOOKUP_INCOMPLETE') then
    raise exception 'Only an unresolved pre-write lookup without a known McLeod match can be processed as an outside carrier' using errcode='40001';
  end if;
  if existing.bale_count is null or existing.bale_count <= 0 or existing.bol_bc is null or existing.bol_bc <= 0 or
     existing.bale_count < coalesce(existing.expected_bale_count,existing.bol_bc) or existing.received_date is null or
     nullif(trim(existing.mark),'') is null or nullif(trim(existing.shipper),'') is null or
     nullif(trim(existing.warehouse_location),'') is null or nullif(trim(existing.sub_location),'') is null or
     existing.equipment_type is null or existing.equipment_type not in ('V','F') or not existing.verified then
    raise exception 'Complete receiving details before processing as an outside carrier' using errcode='22023';
  end if;
  update public.inbound_checkin_rows set draft_status='outside_carrier', processing_error=null,
    processed_at=at_time, checkin_completed_at=coalesce(checkin_completed_at,at_time),
    yard_status='completed', yard_completed_at=coalesce(yard_completed_at,at_time),
    yard_updated_by=actor.email || ' [' || actor.user_id::text || ']',
    outside_carrier_override_request_id=p_request_id, outside_carrier_override_at=at_time,
    outside_carrier_override_by=actor.email || ' [' || actor.user_id::text || ']',
    outside_carrier_override_reason=trim(p_reason)
    where id=p_id returning * into saved;
  insert into public.inbound_outside_carrier_events(checkin_id,request_id,lookup_attempt_id,
    actor_id,actor_user_id,actor_email,created_at,reason,acknowledgement,verification_status,
    lookup_failure_code,lookup_failed_at,before_values,after_values)
  values(p_id,p_request_id,p_lookup_attempt_id,actor.id,actor.user_id,actor.email,at_time,trim(p_reason),
    'Staff acknowledged McLeod verification remains unresolved and no McLeod delivery will be written',
    'unresolved',existing.mcleod_lookup_failure_code,existing.mcleod_lookup_failed_at,to_jsonb(existing),to_jsonb(saved));
  return next saved;
end $$;
revoke all on function public.complete_inbound_outside_carrier(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.complete_inbound_outside_carrier(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid,boolean,text) to service_role;
revoke all on function public.guard_manual_outside_carrier(), public.claim_inbound_checkin_row_v2(uuid) from public,anon,authenticated;
grant execute on function public.guard_manual_outside_carrier(), public.claim_inbound_checkin_row_v2(uuid) to service_role;
commit;
