-- Shipper always pays the flatbed loading fee, per Jaime's instruction.
with before_rows as materialized (
 select location_id,to_jsonb(e) as old_value from public.cotton_location_equipment e where fee_payer<>'shipper'
), changed as (
 update public.cotton_location_equipment e set fee_payer='shipper',version=version+1,updated_at=clock_timestamp()
 from before_rows b where e.location_id=b.location_id
 returning e.location_id,b.old_value,to_jsonb(e) as new_value
)
insert into public.cotton_location_change_events(location_id,action,actor,before_value,after_value,source_reference)
select location_id,'equipment_payer_rule','Jaime Tyler; applied by Codex',old_value,new_value,'SCM instruction: flatbed fee payer is always the shipper' from changed;
alter table public.cotton_location_equipment alter column fee_payer set default 'shipper';
alter table public.cotton_location_equipment add constraint cotton_equipment_shipper_payer check(fee_payer='shipper');
