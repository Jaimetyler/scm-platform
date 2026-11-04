create table public.cotton_location_equipment (
 location_id uuid primary key references public.cotton_location_master(id),
 accepted_equipment text not null default 'unknown' check(accepted_equipment in ('unknown','van_only','van_and_flatbed')),
 fee_basis text not null default 'unknown' check(fee_basis in ('unknown','none','per_load','per_bale','other')),
 fee_amount numeric check(fee_amount>=0 and fee_amount<=100000),
 fee_payer text not null default 'unknown' check(fee_payer in ('unknown','shipper','carrier')),
 conditions text not null default '',source_reference text not null default '',effective_date date,
 verified boolean not null default false,version integer not null default 0,updated_at timestamptz not null default now(),
 check(fee_basis not in ('per_load','per_bale') or fee_amount is not null),
 check(fee_basis<>'unknown' or fee_amount is null),check(fee_basis<>'none' or coalesce(fee_amount,0)=0)
);
alter table public.cotton_location_equipment enable row level security;
revoke all on public.cotton_location_equipment from anon,authenticated;
grant all on public.cotton_location_equipment to service_role;
create function public.save_cotton_equipment(p_location uuid,p_version integer,p_changes jsonb,p_actor text,p_admin boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare old_row public.cotton_location_equipment; new_row public.cotton_location_equipment;
begin
 if nullif(trim(p_actor),'') is null or nullif(trim(p_changes->>'source_reference'),'') is null then raise exception 'Source and actor required'; end if;
 if coalesce((p_changes->>'verified')::boolean,false) and not coalesce(p_admin,false) then raise exception 'Administrator review required'; end if;
 if coalesce((p_changes->>'verified')::boolean,false) and (p_changes->>'accepted_equipment'='unknown' or (p_changes->>'accepted_equipment'='van_and_flatbed' and (p_changes->>'fee_basis'='unknown' or (coalesce((p_changes->>'fee_amount')::numeric,0)>0 and p_changes->>'fee_payer'='unknown')))) then raise exception 'Equipment, fee and payer confirmation required'; end if;
 insert into public.cotton_location_equipment(location_id) values(p_location) on conflict do nothing;
 select * into old_row from public.cotton_location_equipment where location_id=p_location for update;
 if not found or old_row.version<>p_version then raise exception 'Equipment record changed. Refresh before saving.'; end if;
 update public.cotton_location_equipment set accepted_equipment=p_changes->>'accepted_equipment',fee_basis=p_changes->>'fee_basis',fee_amount=(p_changes->>'fee_amount')::numeric,
 fee_payer=p_changes->>'fee_payer',conditions=p_changes->>'conditions',source_reference=p_changes->>'source_reference',effective_date=(p_changes->>'effective_date')::date,
 verified=(p_changes->>'verified')::boolean,version=version+1,updated_at=clock_timestamp() where location_id=p_location returning * into new_row;
 insert into public.cotton_location_change_events(location_id,action,actor,before_value,after_value,source_reference)
 values(p_location,'equipment_review',p_actor,to_jsonb(old_row),to_jsonb(new_row),new_row.source_reference);
 return to_jsonb(new_row);
end $$;
revoke all on function public.save_cotton_equipment(uuid,integer,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.save_cotton_equipment(uuid,integer,jsonb,text,boolean) to service_role;
insert into public.cotton_location_equipment(location_id) select id from public.cotton_location_master;
-- Written tariffs supplied previously. Currency, acceptance and payer still require review.
with evidence(code,amount,source,effective,conditions) as (values
 ('GLASGATX',3.42,'Glasscock County Co-op Tariff 2026.docx; item 18','2026-09-01','Flatbed loading requires 48 hours advance notice. Confirm current restrictions and responsible payer.'),
 ('HALEPLTX',1.50,'911533 HCC Plainview tariff; item 14','2026-09-01','Flatbed loading fee; charges billed to party surrendering warehouse receipt. Confirm whether shipper or carrier is responsible.'),
 ('LOCKLOTX',1.50,'884033 HCC-Lockney tariff; item 14','2026-09-01','Flatbed loading fee; charges billed to party surrendering warehouse receipt. Confirm payer.'),
 ('LOVCLUTX',1.50,'886570 Lov-Cot 2026-09-01 tariff; item 14','2026-09-01','Flatbed loading fee; confirm acceptance conditions and payer.'),
 ('PLAIALOK',2.00,'Tariff2026_PCCA.pdf; item 14','2026-08-01','Flatbed loading fee. Confirm current equipment restrictions and payer.'),
 ('PLAIRUTX',2.00,'Tariff2026_PCCA.pdf; item 14','2026-08-01','Flatbed loading fee. Confirm current equipment restrictions and payer.'),
 ('PLAISWTX',2.00,'Tariff2026_PCCA.pdf; item 14','2026-08-01','Flatbed loading fee. Confirm current equipment restrictions and payer.'),
 ('GULFCOT1',1.50,'Tariff2026-Corpus-Portland.pdf; item 17','2026-07-01','Outbound flatbed loading per bale. Confirm payer.'),
 ('GULFCOT2',1.50,'Tariff2026-Corpus-Portland.pdf; item 17','2026-07-01','Outbound flatbed loading per bale. Confirm payer.'),
 ('GULFPOTX',1.50,'Tariff2026-Corpus-Portland.pdf; item 17','2026-07-01','Outbound flatbed loading per bale. Confirm payer.'),
 ('GULFSWTX',1.50,'Tariff2026-Gulf Compress Sweetwater.pdf; item 17','2026-07-01','Outbound flatbed loading per bale. Confirm payer.'),
 ('TAYLTAT1',1.00,'Taylor Compress Tariff2026.pdf; item 12','2026-07-01','Flatbed loading surcharge. Confirm payer and applicability.'),
 ('TAYLTATX',1.00,'Taylor Compress Tariff2026.pdf; item 12','2026-07-01','Warehouse code 940025. Gulf Taylor tariff lists a different code at this address; confirm ownership, applicable tariff and payer before use.'),
 ('FARMCLTX',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.'),
 ('FARMLETX',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.'),
 ('FARMLUT3',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.'),
 ('FARMLUT4',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.'),
 ('FARMLUT6',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.'),
 ('FARMLUTX',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.'),
 ('FARMSTTX',2.00,'Farmers Tariff.pdf; item 19','2026-09-01','Special service loading flatbed trucks. Confirm acceptance and payer.')
)
update public.cotton_location_equipment e set fee_basis='per_bale',fee_amount=v.amount,source_reference=v.source,effective_date=v.effective::date,conditions=v.conditions
from evidence v join public.cotton_location_master l on l.mcleod_code=v.code where e.location_id=l.id;
update public.cotton_location_equipment e set accepted_equipment='van_only',source_reference='Unverified McLeod location name: '||l.mcleod_code,conditions='Historical name says van only. Confirm with current written tariff before booking.'
from public.cotton_location_master l where e.location_id=l.id and l.name ~* 'van[[:space:]]*only' and e.source_reference='';
insert into public.cotton_location_change_events(location_id,action,actor,after_value,source_reference)
select location_id,'equipment_evidence_prefill','Codex; tariff evidence collection authorized by Jaime Tyler',to_jsonb(e),source_reference from public.cotton_location_equipment e where source_reference<>'';
