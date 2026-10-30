-- Additive server-only completion for the ordinary staff Finish cotton action.
-- Requires migration 046. Does not rewrite its RPC, guards, or historical audits.
-- The legacy acknowledgement column stores explicit non-acknowledgment provenance
-- for these events; it must never imply that staff confirmed an unresolved lookup.
-- UPDATE, inventory-trigger work, and audit INSERT are one atomic transaction.
begin;
create function public.complete_inbound_outside_carrier_auto(
  p_id uuid, p_terminal text, p_site_code text, p_expected_updated_at timestamptz,
  p_lookup_attempt_id uuid, p_request_id uuid, p_staff_id uuid, p_user_id uuid)
returns setof public.inbound_checkin_rows
language plpgsql security invoker set search_path=public as $$
declare
  actor public.scm_staff;
  existing public.inbound_checkin_rows;
  saved public.inbound_checkin_rows;
  previous public.inbound_outside_carrier_events;
  at_time timestamptz := clock_timestamp();
  fallback_reason constant text := 'Outside-carrier fallback applied during staff Finish cotton; McLeod verification incomplete; no McLeod update.';
  fallback_provenance constant text := 'Automatic fallback from staff Finish cotton. No separate staff acknowledgment was requested or recorded.';
begin
  if p_request_id is null or p_lookup_attempt_id is null or p_expected_updated_at is null then
    raise exception 'A stable completion request, lookup attempt and row revision are required' using errcode='22023';
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
       previous.actor_id=p_staff_id and previous.actor_user_id=p_user_id and previous.reason=fallback_reason and previous.acknowledgement=fallback_provenance and
       existing.outside_carrier_override_request_id=p_request_id and
       existing.draft_status='outside_carrier' and existing.yard_status='completed' then
      return next existing;
      return;
    end if;
    raise exception 'This arrival has already been completed; refresh the line' using errcode='40001';
  end if;
  if existing.updated_at is distinct from p_expected_updated_at or
     existing.mcleod_lookup_attempt_id is distinct from p_lookup_attempt_id then
    raise exception 'This arrival changed. Refresh the saved status before finishing cotton' using errcode='40001';
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
     existing.equipment_type is null or existing.equipment_type not in ('V','F') or existing.verified is distinct from true then
    raise exception 'Complete receiving details before processing as an outside carrier' using errcode='22023';
  end if;
  update public.inbound_checkin_rows set draft_status='outside_carrier', processing_error=null,
    processed_at=at_time, checkin_completed_at=coalesce(checkin_completed_at,at_time),
    yard_status='completed', yard_completed_at=coalesce(yard_completed_at,at_time),
    yard_updated_by=actor.email || ' [' || actor.user_id::text || ']',
    outside_carrier_override_request_id=p_request_id, outside_carrier_override_at=at_time,
    outside_carrier_override_by=actor.email || ' [' || actor.user_id::text || ']',
    outside_carrier_override_reason=fallback_reason
    where id=p_id returning * into saved;
  insert into public.inbound_outside_carrier_events(checkin_id,request_id,lookup_attempt_id,
    actor_id,actor_user_id,actor_email,created_at,reason,acknowledgement,verification_status,
    lookup_failure_code,lookup_failed_at,before_values,after_values)
  values(p_id,p_request_id,p_lookup_attempt_id,actor.id,actor.user_id,actor.email,at_time,fallback_reason,
    fallback_provenance,
    'unresolved',existing.mcleod_lookup_failure_code,existing.mcleod_lookup_failed_at,to_jsonb(existing),to_jsonb(saved));
  return next saved;
end $$;
revoke all on function public.complete_inbound_outside_carrier_auto(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_inbound_outside_carrier_auto(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid) to service_role;
commit;
