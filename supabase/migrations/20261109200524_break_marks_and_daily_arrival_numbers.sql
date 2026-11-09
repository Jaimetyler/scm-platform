begin;
create table public.warehouse_break_imports (
 request_id uuid primary key,
 terminal text not null,
 site_code text not null,
 customer text not null,
 payload jsonb not null,
 result jsonb,
 created_by text not null,
 created_at timestamptz not null default now()
);
alter table public.warehouse_break_imports enable row level security;
revoke all on public.warehouse_break_imports from public,anon,authenticated;
grant select,insert,update on public.warehouse_break_imports to service_role;
alter table public.warehouse_inventory_lots add column shipping_order text,
 add column break_import_id uuid references public.warehouse_break_imports(request_id);
create unique index warehouse_break_mark_identity on public.warehouse_inventory_lots
 (terminal,site_code,upper(btrim(customer)),upper(btrim(mark)),coalesce(shipping_order,'')) where source_type='break';

create function public.import_warehouse_break_marks(p_request uuid,p_terminal text,p_site text,p_site_name text,p_customer text,p_location text,p_rows jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare prior public.warehouse_break_imports; item jsonb; lot public.warehouse_inventory_lots;
 ids jsonb:='[]'; made integer:=0; skipped integer:=0; v_result jsonb;
 customer_name text:=upper(btrim(p_customer));
begin
 if p_request is null or p_terminal not in ('HOU','SAV','DAL') or nullif(btrim(p_site),'') is null
  or nullif(btrim(p_site_name),'') is null or nullif(customer_name,'') is null or length(customer_name)>200
  or nullif(btrim(p_actor),'') is null or length(coalesce(p_location,''))>120
  or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 250 then
  raise exception 'Enter a valid warehouse, customer and 1-250 break marks' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtext('warehouse-break-import'),hashtext(p_terminal||':'||p_site));
 select * into prior from public.warehouse_break_imports where request_id=p_request;
 if found then
  if prior.terminal<>p_terminal or prior.site_code<>p_site or prior.customer<>customer_name
   or prior.payload is distinct from jsonb_build_object('rows',p_rows,'location',coalesce(p_location,'')) then
   raise exception 'This import request was already used with different data' using errcode='40001';
  end if;
  return prior.result;
 end if;
 if (select count(distinct upper(btrim(x->>'mark'))) from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then
  raise exception 'Duplicate break marks in pasted rows' using errcode='22023';
 end if;
 insert into public.warehouse_break_imports(request_id,terminal,site_code,customer,payload,created_by)
 values(p_request,p_terminal,p_site,customer_name,jsonb_build_object('rows',p_rows,'location',coalesce(p_location,'')),p_actor);
 for item in select value from jsonb_array_elements(p_rows) loop
  if coalesce(item->>'mark','')!~'^[A-Z0-9][A-Z0-9 ._/-]{0,79}$' or coalesce(item->>'bales','')!~'^[0-9]{1,7}$'
   or (item->>'bales')::integer not between 1 and 1000000 or length(coalesce(item->>'shippingOrder',''))>200 then
   raise exception 'Invalid break-mark row' using errcode='22023';
  end if;
  select * into lot from public.warehouse_inventory_lots where terminal=p_terminal and site_code=p_site and source_type='break'
   and upper(btrim(mark))=item->>'mark' and upper(btrim(customer))=customer_name and coalesce(shipping_order,'')=coalesce(item->>'shippingOrder','') for update;
  if found then
   if lot.original_bales<>(item->>'bales')::integer then
    raise exception 'Break mark % already exists with a different quantity. Review inventory instead of importing it again.',item->>'mark' using errcode='40001';
   end if;
   skipped:=skipped+1; ids:=ids||jsonb_build_array(lot.id);continue;
  end if;
  if exists(select 1 from public.warehouse_inventory_lots where terminal=p_terminal and site_code=p_site
   and upper(btrim(mark))=item->>'mark' and inventory_status<>'closed' and current_bales>0) then
   raise exception 'Mark % already has inventory here. Review it before adding a break mark.',item->>'mark' using errcode='40001';
  end if;
  insert into public.warehouse_inventory_lots(source_type,terminal,site_code,site_name,sub_location,received_date,mark,customer,
   original_bales,current_bales,allocated_bales,missing_bales,warehouse_location,inventory_status,ecotton_receipt_status,shipping_order,break_import_id,source_notes,notes)
  values('break',p_terminal,p_site,p_site_name,'MAIN',(now() at time zone case when p_terminal='SAV' then 'America/New_York' else 'America/Chicago' end)::date,
   item->>'mark',customer_name,(item->>'bales')::integer,(item->>'bales')::integer,0,0,nullif(btrim(p_location),''),'active','not_required',
   nullif(item->>'shippingOrder',''),p_request,'Temporary break-mark import; original source marks not deducted; reconciliation pending.',
   'Break mark · source inventory reconciliation pending.') returning * into lot;
  insert into public.warehouse_inventory_events(inventory_lot_id,event_type,quantity_delta,to_mark,to_location,changed_by,note,after_values)
   values(lot.id,'break',lot.current_bales,lot.mark,p_location,p_actor,'Temporary break mark added without source deductions; reconciliation pending.',to_jsonb(lot));
  made:=made+1;ids:=ids||jsonb_build_array(lot.id);
 end loop;
 v_result:=jsonb_build_object('created',made,'existing',skipped,'lotIds',ids);
 update public.warehouse_break_imports set result=v_result where request_id=p_request;
 return v_result;
end $$;
revoke all on function public.import_warehouse_break_marks(uuid,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.import_warehouse_break_marks(uuid,text,text,text,text,text,jsonb,text) to service_role;

-- Durable daily numbers are separate from the active rows: checkout, removal,
-- filtering and deletion must never renumber remaining arrivals or reuse a number.
create table public.warehouse_arrival_counters (
 terminal text not null,site_code text not null,queue_day date not null,last_number integer not null,
 primary key(terminal,site_code,queue_day)
);
create table public.warehouse_arrival_numbers (
 checkin_id uuid primary key references public.inbound_checkin_rows(id) on delete cascade,
 terminal text not null,site_code text not null,queue_day date not null,queue_number integer not null check(queue_number>0),
 unique(terminal,site_code,queue_day,queue_number)
);
alter table public.warehouse_arrival_counters enable row level security;
alter table public.warehouse_arrival_numbers enable row level security;
revoke all on public.warehouse_arrival_counters,public.warehouse_arrival_numbers from public,anon,authenticated;
grant select on public.warehouse_arrival_counters,public.warehouse_arrival_numbers to service_role;
lock table public.inbound_checkin_rows in share row exclusive mode;
insert into public.warehouse_arrival_numbers(checkin_id,terminal,site_code,queue_day,queue_number)
 select id,terminal,site_code,queue_day,row_number() over(partition by terminal,site_code,queue_day order by checked_in_at,created_at,id)::integer
 from (select *, (checked_in_at at time zone case when terminal='SAV' then 'America/New_York' else 'America/Chicago' end)::date queue_day
  from public.inbound_checkin_rows where checked_in_at is not null and yard_status is not null and material_type in ('cotton','lumber','other')) arrivals;
insert into public.warehouse_arrival_counters select terminal,site_code,queue_day,max(queue_number) from public.warehouse_arrival_numbers group by terminal,site_code,queue_day;
create function public.assign_warehouse_arrival_number() returns trigger
language plpgsql security definer set search_path=public as $$
declare day date; number integer;
begin
 if new.checked_in_at is null or new.yard_status is null or new.material_type not in ('cotton','lumber','other')
  or exists(select 1 from public.warehouse_arrival_numbers where checkin_id=new.id) then return new;end if;
 day:=(new.checked_in_at at time zone case when new.terminal='SAV' then 'America/New_York' else 'America/Chicago' end)::date;
 insert into public.warehouse_arrival_counters as c(terminal,site_code,queue_day,last_number) values(new.terminal,new.site_code,day,1)
 on conflict(terminal,site_code,queue_day) do update set last_number=c.last_number+1 returning last_number into number;
 insert into public.warehouse_arrival_numbers values(new.id,new.terminal,new.site_code,day,number);
 return new;
end $$;
revoke all on function public.assign_warehouse_arrival_number() from public,anon,authenticated;
create trigger assign_warehouse_arrival_number after insert or update of checked_in_at,yard_status on public.inbound_checkin_rows
 for each row execute function public.assign_warehouse_arrival_number();
commit;
