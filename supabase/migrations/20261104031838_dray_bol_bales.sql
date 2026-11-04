alter table public.dray_import_items add column bol_bales integer check(bol_bales between 1 and 1000);
create function public.save_dray_bol_bales(p_run uuid,p_details jsonb,p_actor text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d jsonb; i record; n integer;
begin
 if jsonb_typeof(p_details)<>'array' or jsonb_array_length(p_details)>500 or nullif(trim(p_actor),'') is null then raise exception 'Invalid BOL details';end if;
 for d in select value from jsonb_array_elements(p_details) loop
 n:=(d->>'bales')::integer;if n not between 1 and 1000 then raise exception 'Invalid bale count';end if;
 for i in select x.id,x.order_id,x.bol_bales,o.status from public.dray_import_items x join public.dray_import_orders o on o.id=x.order_id
 where x.run_id=p_run and not x.conflict and x.source_hash=o.source_hash and o.invoice->>'sourceKey'=d->>'sourceKey' for update of x loop
 if i.bol_bales is not null and i.bol_bales<>n then raise exception 'Bale count differs from saved BOL details';end if;
 if i.bol_bales is null then
 update public.dray_import_items set bol_bales=n where id=i.id;
 insert into public.dray_import_events(order_id,actor,from_state,to_state,note) values(i.order_id,p_actor,i.status,i.status,'BOL bale count saved from report: '||n);
 end if;
 end loop;
 end loop;
end $$;
revoke all on function public.save_dray_bol_bales(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_dray_bol_bales(uuid,jsonb,text) to service_role;
grant update(bol_bales) on public.dray_import_items to service_role;

create table public.dray_bol_images (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.dray_import_orders(id),
 mcleod_order text not null,pdf_hash text not null check(length(pdf_hash)=64),document_type text not null,
 status text not null check(status in ('sending','staged','verified','uncertain')),receipt text,actor text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(mcleod_order,pdf_hash)
);
alter table public.dray_bol_images enable row level security;
revoke all on public.dray_bol_images from public,anon,authenticated;
grant select,insert,update on public.dray_bol_images to service_role;
