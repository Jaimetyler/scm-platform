begin;
lock table public.inbound_checkin_rows in share row exclusive mode;
lock table public.warehouse_arrival_numbers in share row exclusive mode;
alter table public.warehouse_arrival_numbers
 add column freight_group text check (freight_group in ('cotton','domestic')),
 add column freight_number integer check (freight_number > 0);
with numbered as (
 select n.checkin_id, case when r.material_type='cotton' then 'cotton' else 'domestic' end freight_group,
 row_number() over (partition by n.terminal,n.site_code,n.queue_day,
 case when r.material_type='cotton' then 'cotton' else 'domestic' end
 order by r.checked_in_at,r.created_at,r.id)::integer freight_number
 from public.warehouse_arrival_numbers n join public.inbound_checkin_rows r on r.id=n.checkin_id
)
update public.warehouse_arrival_numbers n set freight_group=b.freight_group,freight_number=b.freight_number
 from numbered b where n.checkin_id=b.checkin_id;
alter table public.warehouse_arrival_numbers alter column freight_group set not null,
 alter column freight_number set not null,
 add unique (terminal,site_code,queue_day,freight_group,freight_number);
create table public.warehouse_freight_counters (
 terminal text not null, site_code text not null, queue_day date not null,
 freight_group text not null check (freight_group in ('cotton','domestic')),
 last_number integer not null check (last_number>0),
 primary key (terminal,site_code,queue_day,freight_group)
);
alter table public.warehouse_freight_counters enable row level security;
revoke all on public.warehouse_freight_counters from public,anon,authenticated;
grant select on public.warehouse_freight_counters to service_role;
insert into public.warehouse_freight_counters
 select terminal,site_code,queue_day,freight_group,max(freight_number)
 from public.warehouse_arrival_numbers group by terminal,site_code,queue_day,freight_group;
create or replace function public.assign_warehouse_arrival_number() returns trigger
language plpgsql security definer set search_path=public as $$
declare day date; number integer; freight text; freight_no integer;
begin
 if new.checked_in_at is null or new.yard_status is null or new.material_type not in ('cotton','lumber','other')
 or exists(select 1 from public.warehouse_arrival_numbers where checkin_id=new.id) then return new;end if;
 day:=(new.checked_in_at at time zone case when new.terminal='SAV' then 'America/New_York' else 'America/Chicago' end)::date;
 freight:=case when new.material_type='cotton' then 'cotton' else 'domestic' end;
 insert into public.warehouse_arrival_counters as c(terminal,site_code,queue_day,last_number)
 values(new.terminal,new.site_code,day,1)
 on conflict(terminal,site_code,queue_day) do update set last_number=c.last_number+1 returning last_number into number;
 insert into public.warehouse_freight_counters as c(terminal,site_code,queue_day,freight_group,last_number)
 values(new.terminal,new.site_code,day,freight,1)
 on conflict(terminal,site_code,queue_day,freight_group) do update set last_number=c.last_number+1 returning last_number into freight_no;
 insert into public.warehouse_arrival_numbers(checkin_id,terminal,site_code,queue_day,queue_number,freight_group,freight_number)
 values(new.id,new.terminal,new.site_code,day,number,freight,freight_no);
 return new;
end $$;
revoke all on function public.assign_warehouse_arrival_number() from public,anon,authenticated;
commit;
