create table public.cotton_tariff_outreach (
 location_id uuid primary key references public.cotton_location_master(id),
 owner text not null default 'Hope',priority boolean not null default false,priority_reason text not null default '',
 status text not null default 'not_requested' check(status in ('not_requested','requested','follow_up','received','reviewed')),
 contact_name text not null default '',contact_email text not null default '',contact_phone text not null default '',
 last_contact date,next_follow_up date,effective_date date,notes text not null default '',
 version integer not null default 0,updated_at timestamptz not null default now()
);
create table public.cotton_tariff_documents (
 id uuid primary key,location_id uuid not null references public.cotton_tariff_outreach(location_id),
 path text unique not null,filename text not null,uploaded_by text not null,uploaded_at timestamptz not null default now()
);
create index cotton_tariff_documents_location_idx on public.cotton_tariff_documents(location_id);
create table public.cotton_tariff_outreach_events (
 id bigint generated always as identity primary key,location_id uuid not null references public.cotton_tariff_outreach(location_id),
 action text not null,actor text not null,before_value jsonb,after_value jsonb,created_at timestamptz not null default now()
);
create index cotton_tariff_outreach_events_location_idx on public.cotton_tariff_outreach_events(location_id,created_at desc);
alter table public.cotton_tariff_outreach enable row level security;
alter table public.cotton_tariff_documents enable row level security;
alter table public.cotton_tariff_outreach_events enable row level security;
revoke all on public.cotton_tariff_outreach,public.cotton_tariff_documents,public.cotton_tariff_outreach_events from anon,authenticated;
grant all on public.cotton_tariff_outreach,public.cotton_tariff_documents,public.cotton_tariff_outreach_events to service_role;
grant usage,select on sequence public.cotton_tariff_outreach_events_id_seq to service_role;

create function public.save_cotton_tariff_outreach(p_location uuid,p_version integer,p_changes jsonb,p_actor text,p_admin boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare old_row public.cotton_tariff_outreach; new_row public.cotton_tariff_outreach;
begin
 select * into old_row from public.cotton_tariff_outreach where location_id=p_location for update;
 if not found or old_row.version<>p_version then raise exception 'This facility changed. Refresh before saving.'; end if;
 if nullif(trim(p_actor),'') is null then raise exception 'Actor required'; end if;
 if p_changes->>'status' in ('received','reviewed') and not exists(select 1 from public.cotton_tariff_documents where location_id=p_location) then raise exception 'Upload the tariff before marking it received or reviewed.'; end if;
 if p_changes->>'status'='reviewed' and (not coalesce(p_admin,false) or nullif(p_changes->>'effective_date','') is null) then raise exception 'An administrator and tariff effective date are required for review.'; end if;
 if old_row.status='reviewed' and not coalesce(p_admin,false) then raise exception 'An administrator must revise a reviewed record.'; end if;
 update public.cotton_tariff_outreach set
 owner=p_changes->>'owner',priority=(p_changes->>'priority')::boolean,status=p_changes->>'status',
 contact_name=p_changes->>'contact_name',contact_email=p_changes->>'contact_email',contact_phone=p_changes->>'contact_phone',
 last_contact=(p_changes->>'last_contact')::date,next_follow_up=(p_changes->>'next_follow_up')::date,effective_date=(p_changes->>'effective_date')::date,
 notes=p_changes->>'notes',version=version+1,updated_at=clock_timestamp() where location_id=p_location returning * into new_row;
 insert into public.cotton_tariff_outreach_events(location_id,action,actor,before_value,after_value) values(p_location,'outreach_update',p_actor,to_jsonb(old_row),to_jsonb(new_row));
 return to_jsonb(new_row);
end $$;
create function public.record_cotton_tariff_document(p_id uuid,p_location uuid,p_path text,p_filename text,p_actor text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare old_row public.cotton_tariff_outreach;
begin
 select * into old_row from public.cotton_tariff_outreach where location_id=p_location for update;
 if not found then raise exception 'Unknown facility'; end if;
 if nullif(trim(p_actor),'') is null or p_path not like p_location::text||'/'||p_id::text||'.%' then raise exception 'Invalid document'; end if;
 insert into public.cotton_tariff_documents(id,location_id,path,filename,uploaded_by) values(p_id,p_location,p_path,p_filename,p_actor);
 update public.cotton_tariff_outreach set status='received',version=version+1,updated_at=clock_timestamp() where location_id=p_location;
 insert into public.cotton_tariff_outreach_events(location_id,action,actor,before_value,after_value) values(p_location,'tariff_uploaded',p_actor,to_jsonb(old_row),jsonb_build_object('document_id',p_id,'filename',p_filename,'status','received'));
end $$;
revoke all on function public.save_cotton_tariff_outreach(uuid,integer,jsonb,text,boolean),public.record_cotton_tariff_document(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_cotton_tariff_outreach(uuid,integer,jsonb,text,boolean),public.record_cotton_tariff_document(uuid,uuid,text,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cotton-tariffs','cotton-tariffs',false,3145728,array['application/pdf','image/jpeg','image/png']);

insert into public.cotton_tariff_outreach(location_id,owner)
select id,'Hope' from public.cotton_location_master;
-- Provisional first batch: southeastern facilities missing saved hours; recorded fee warnings first.
-- Exclude obvious obsolete/duplicate facilities. This is not a load-volume ranking.
with batch as (
 select l.id from public.cotton_location_master l
 where l.state in ('GA','SC','NC','AL')
 and l.name !~* 'DUPLICATE|DONT USE|NO COTTON HERE'
 and not exists(select 1 from public.cotton_location_schedules s where s.location_id=l.id and s.open_time is not null)
 order by case when l.name ~* 'NO GRACE|FEE|\\$' then 0 else 1 end,l.mcleod_code limit 10
)
update public.cotton_tariff_outreach set priority=true,priority_reason='Starting batch: missing saved hours; southeastern facilities and recorded fee warnings prioritized. Confirm current written tariff first.' where location_id in (select id from batch);
insert into public.cotton_tariff_outreach_events(location_id,action,actor,after_value)
select location_id,'queue_created','SCM outreach setup',to_jsonb(q) from public.cotton_tariff_outreach q;
