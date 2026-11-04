-- Operational default requested by Jaime; not a tariff confirmation.
create function public.apply_cotton_equipment_state_default(p_location uuid,p_state text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare before_row public.cotton_location_equipment; after_row public.cotton_location_equipment;
begin
 if upper(trim(p_state)) not in ('GA','SC','AL','FL','NC','VA','TN','AR','MS') or p_state is null then return; end if;
 insert into public.cotton_location_equipment(location_id) values(p_location) on conflict do nothing;
 select * into before_row from public.cotton_location_equipment where location_id=p_location for update;
 -- A specific recorded policy wins over the regional default.
 if before_row.accepted_equipment<>'unknown' or before_row.verified then return; end if;
 update public.cotton_location_equipment set accepted_equipment='van_only',version=version+1,updated_at=clock_timestamp(),
 source_reference=concat_ws('; ',nullif(source_reference,''),'SCM operational default requested by Jaime Tyler: GA, SC, AL, FL, NC, VA, TN, AR, MS are van only'),
 conditions=concat_ws(' ',nullif(conditions,''),'Van only by SCM state default; facility tariff confirmation pending.')
 where location_id=p_location returning * into after_row;
 insert into public.cotton_location_change_events(location_id,action,actor,before_value,after_value,source_reference)
 values(p_location,'equipment_state_default','Jaime Tyler; applied by Codex',to_jsonb(before_row),to_jsonb(after_row),after_row.source_reference);
end $$;
revoke all on function public.apply_cotton_equipment_state_default(uuid,text) from public,anon,authenticated;
grant execute on function public.apply_cotton_equipment_state_default(uuid,text) to service_role;
create function public.default_cotton_location_equipment()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.apply_cotton_equipment_state_default(new.id,new.state);
 return new;
end $$;
revoke all on function public.default_cotton_location_equipment() from public,anon,authenticated;
grant execute on function public.default_cotton_location_equipment() to service_role;
create trigger cotton_location_equipment_state_default after insert or update of state on public.cotton_location_master
for each row execute function public.default_cotton_location_equipment();
select public.apply_cotton_equipment_state_default(id,state) from public.cotton_location_master;
