-- Additive import ledger. No production orders or existing import tables are changed.
create table public.ecotton_import_runs (
 id uuid primary key default gen_random_uuid(), source_digest text not null unique check(length(source_digest)=64),
 profile jsonb not null, actor text not null, created_at timestamptz not null default now()
);
create table public.ecotton_import_orders (
 id uuid primary key default gen_random_uuid(),terminal text not null check(terminal in ('HOU','DAL','SAV')),
 location text not null,reference text not null,invoice jsonb not null,profile jsonb not null,source_hash text not null,
 status text not null check(status in ('ready','preview_blocked','blocked','creating','creation_uncertain','created','rating','rating_uncertain','verified')),
 order_id text,version integer not null default 0,note text not null default '',updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(),unique(terminal,location,reference)
);
create table public.ecotton_import_items (
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.ecotton_import_runs(id),
 order_id uuid not null references public.ecotton_import_orders(id),position integer not null,
 source_hash text not null,conflict boolean not null default false,unique(run_id,position),unique(run_id,order_id)
);
create table public.ecotton_import_events (
 id bigint generated always as identity primary key,order_id uuid not null references public.ecotton_import_orders(id),
 actor text not null,from_state text,to_state text not null,order_number text,note text not null,created_at timestamptz not null default now()
);
create index ecotton_import_items_order_idx on public.ecotton_import_items(order_id);
create index ecotton_import_events_order_idx on public.ecotton_import_events(order_id,id);
alter table public.ecotton_import_runs enable row level security;
alter table public.ecotton_import_orders enable row level security;
alter table public.ecotton_import_items enable row level security;
alter table public.ecotton_import_events enable row level security;
revoke all on public.ecotton_import_runs,public.ecotton_import_orders,public.ecotton_import_items,public.ecotton_import_events from public,anon,authenticated;
grant select,insert on public.ecotton_import_runs,public.ecotton_import_items,public.ecotton_import_events to service_role;
grant select,insert,update on public.ecotton_import_orders to service_role;
grant usage,select on sequence public.ecotton_import_events_id_seq to service_role;

create function public.prepare_ecotton_import(p_digest text,p_profile jsonb,p_rows jsonb,p_actor text) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare run uuid; item jsonb; saved public.ecotton_import_orders; n integer:=0;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Invalid import rows'; end if;
 insert into public.ecotton_import_runs(source_digest,profile,actor) values(p_digest,p_profile,p_actor) on conflict(source_digest) do nothing returning id into run;
 if run is null then select id into run from public.ecotton_import_runs where source_digest=p_digest;return run;end if;
 for item in select value from jsonb_array_elements(p_rows) loop
 n:=n+1;
 insert into public.ecotton_import_orders(terminal,location,reference,invoice,profile,source_hash,status,note,order_id)
 values(p_profile->>'terminal',p_profile->>'location',upper(trim(item->'invoice'->>'reference')),item->'invoice',p_profile,item->>'source_hash',item->>'status',item->>'note',nullif(item->>'order_id',''))
 on conflict(terminal,location,reference) do nothing returning * into saved;
 if saved.id is null then select * into saved from public.ecotton_import_orders where terminal=p_profile->>'terminal' and location=p_profile->>'location' and reference=upper(trim(item->'invoice'->>'reference')) for update;
 else insert into public.ecotton_import_events(order_id,actor,to_state,order_number,note) values(saved.id,p_actor,saved.status,saved.order_id,'Import preview: '||saved.note);end if;
 insert into public.ecotton_import_items(run_id,order_id,position,source_hash,conflict) values(run,saved.id,n,item->>'source_hash',saved.source_hash<>item->>'source_hash');
 end loop;
 return run;
end $$;

create function public.transition_ecotton_import(p_id uuid,p_version integer,p_from text,p_to text,p_order text,p_note text,p_actor text)
returns setof public.ecotton_import_orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.ecotton_import_orders;
begin
 if not ((p_from='preview_blocked' and p_to in ('ready','preview_blocked','verified')) or (p_from='ready' and p_to='creating') or (p_from='creating' and p_to in ('ready','blocked','creation_uncertain','created','verified')) or
 (p_from='created' and p_to in ('rating','blocked','verified')) or (p_from='rating' and p_to in ('created','blocked','rating_uncertain','verified')) or
 (p_from in ('creation_uncertain','rating_uncertain','blocked') and p_to in ('blocked','verified'))) then raise exception 'Invalid import state transition';end if;
 update public.ecotton_import_orders set status=p_to,order_id=coalesce(p_order,order_id),note=left(p_note,2000),version=version+1,updated_at=clock_timestamp()
 where id=p_id and version=p_version and status=p_from returning * into saved;
 if saved.id is null then return;end if;
 insert into public.ecotton_import_events(order_id,actor,from_state,to_state,order_number,note) values(saved.id,p_actor,p_from,p_to,saved.order_id,saved.note);
 return next saved;
end $$;
revoke all on function public.prepare_ecotton_import(text,jsonb,jsonb,text),public.transition_ecotton_import(uuid,integer,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_ecotton_import(text,jsonb,jsonb,text),public.transition_ecotton_import(uuid,integer,text,text,text,text,text) to service_role;
