CREATE OR REPLACE FUNCTION public.guard_manual_outside_carrier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
     coalesce(old.mcleod_processing_phase,'') not in ('lookup','matched','write_pending') and
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
end $function$
