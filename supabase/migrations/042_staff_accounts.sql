begin;
create table public.scm_staff (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  name text not null,
  user_id uuid unique,
  role text not null check (role in ('admin','operator','viewer')),
  terminal text check (terminal in ('HOU','SAV')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  invite_expires_at timestamptz not null default (now() + interval '7 days'),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((role = 'operator' and terminal is not null) or (role <> 'operator' and terminal is null))
);
create table public.scm_staff_activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text not null,
  action text not null,
  target text,
  response_status integer,
  created_at timestamptz not null default now()
);
alter table public.scm_staff enable row level security;
alter table public.scm_staff_activity enable row level security;
revoke all on public.scm_staff, public.scm_staff_activity from public, anon, authenticated;
grant select,insert,update on public.scm_staff, public.scm_staff_activity to service_role;

-- Serialize account administration; two administrators cannot disable each other
-- concurrently and leave the organization without an active administrator.
create function public.scm_manage_staff(p_actor uuid, p_action text, p_target uuid default null,
  p_email text default null, p_name text default null, p_role text default null, p_terminal text default null)
returns public.scm_staff language plpgsql security definer set search_path=public as $$
declare actor public.scm_staff; result public.scm_staff;
begin
  perform pg_advisory_xact_lock(780214);
  select * into actor from public.scm_staff where id=p_actor and role='admin' and status='active';
  if not found then raise exception 'Administrator access required'; end if;
  if p_action='invite' then
    insert into public.scm_staff(email,name,role,terminal)
      values(lower(trim(p_email)),p_name,p_role,p_terminal) returning * into result;
  else
    select * into result from public.scm_staff where id=p_target for update;
    if not found then raise exception 'Staff account not found'; end if;
    if p_action='resend' and result.status='pending' then
      update public.scm_staff set invite_expires_at=now()+interval '7 days', invited_at=now(),updated_at=now()
        where id=p_target returning * into result;
    elsif p_action='disable' then
      if result.id=p_actor then raise exception 'You cannot deactivate your own account'; end if;
      if result.role='admin' and result.status='active' and
        (select count(*) from public.scm_staff where role='admin' and status='active') <= 1 then
        raise exception 'Keep at least one active administrator';
      end if;
      update public.scm_staff set status='disabled',updated_at=now() where id=p_target returning * into result;
    elsif p_action='access' and result.status='active' then
      if result.id=p_actor then raise exception 'Another administrator must change your access'; end if;
      update public.scm_staff set role=p_role,terminal=p_terminal,updated_at=now() where id=p_target returning * into result;
    else raise exception 'Action is not available for this account'; end if;
  end if;
  insert into public.scm_staff_activity(actor_id,actor_email,action,target)
    values(actor.id,actor.email,'staff:'||p_action,result.id::text);
  return result;
end $$;
revoke all on function public.scm_manage_staff(uuid,text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.scm_manage_staff(uuid,text,uuid,text,text,text,text) to service_role;

create function public.scm_accept_staff(p_id uuid, p_user_id uuid, p_email text)
returns public.scm_staff language plpgsql security definer set search_path=public as $$
declare result public.scm_staff;
begin
  update public.scm_staff set status='active',user_id=p_user_id,accepted_at=now(),updated_at=now()
  where id=p_id and email=lower(p_email) and status='pending' and invite_expires_at>now()
    and (user_id is null or user_id=p_user_id) returning * into result;
  if not found then raise exception 'Invitation expired or cancelled'; end if;
  insert into public.scm_staff_activity(actor_id,actor_email,action,target)
    values(result.id,result.email,'staff:accepted',result.id::text);
  return result;
end $$;
revoke all on function public.scm_accept_staff(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.scm_accept_staff(uuid,uuid,text) to service_role;

-- Bootstrap is available only to the server role and serializes competing runs.
create function public.scm_bootstrap_staff(p_email text, p_name text)
returns public.scm_staff language plpgsql security definer set search_path=public as $$
declare result public.scm_staff;
begin
  perform pg_advisory_xact_lock(780214);
  if exists(select 1 from public.scm_staff where role='admin' and
      (status='active' or email<>lower(trim(p_email)) or status='disabled')) then
    raise exception 'An administrator is already configured. Use Manage users.';
  end if;
  insert into public.scm_staff(email,name,role,terminal,status)
    values(lower(trim(p_email)),p_name,'admin',null,'pending')
    on conflict(email) do update set invite_expires_at=now()+interval '7 days',invited_at=now(),updated_at=now()
    where scm_staff.role='admin' and scm_staff.status='pending'
    returning * into result;
  if result.id is null then raise exception 'This email is already assigned to another staff account'; end if;
  return result;
end $$;
revoke all on function public.scm_bootstrap_staff(text,text) from public,anon,authenticated;
grant execute on function public.scm_bootstrap_staff(text,text) to service_role;

-- Staff use server APIs; Supabase Auth JWTs must not expose service-role data or
-- SECURITY DEFINER RPCs directly. Scope this to known SCM objects only.
do $$ declare object record; begin
  for object in select c.oid::regclass as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','v','m','p') and c.relname = any(array['container_gate_queue', 'cotton_outbound_booking_dashboard', 'cotton_outbound_booking_search_dashboard', 'cotton_outbound_booking_lines', 'cotton_outbound_booking_transfers', 'cotton_outbound_bookings', 'cotton_outbound_containers', 'cotton_outbound_mark_events', 'cotton_outbound_source_arrivals', 'customer_xref', 'driver_checkin_sites', 'inbound_checkin_rows', 'inbound_results', 'inbound_shortage_events', 'order_import_rows', 'order_import_runs', 'pnl_classified_rows', 'pnl_raw_rows', 'pnl_rule_log', 'pnl_uploads', 'tariff_charge_xref', 'terminal_defaults', 'v_latest_pnl_uploads', 'v_pnl_detail_lines', 'v_pnl_exceptions', 'v_pnl_monthly_summary', 'v_pnl_summary_by_entity', 'warehouse_inventory_events', 'warehouse_inventory_lots']) loop
    execute format('revoke all on %s from public, anon, authenticated',object.name);
    execute format('grant all on %s to service_role',object.name);
  end loop;
  for object in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array['add_cotton_outbound_booking_mark', 'assign_cotton_outbound_booking_marks', 'audit_inbound_shortage', 'bulk_roll_cotton_outbound_booking_lines', 'change_cotton_outbound_mark', 'claim_inbound_checkin_row', 'classify_pnl_entity', 'complete_processed_cotton_yard', 'container_queue_position', 'create_cotton_outbound_booking_draft', 'create_cotton_outbound_booking_draft_with_details', 'ensure_cotton_outbound_container_slots', 'flag_cotton_outbound_source_checkin', 'flag_cotton_outbound_source_line', 'guard_cotton_outbound_mark_equipment', 'guard_cotton_outbound_split_row', 'guard_inbound_shortage', 'prevent_duplicate_freight_checkin', 'process_pnl_upload', 'roll_cotton_outbound_booking_line', 'set_updated_at_container_gate_queue', 'set_updated_at_cotton_outbound_booking', 'set_updated_at_cotton_outbound_container', 'set_updated_at_driver_checkin_sites', 'set_updated_at_inbound_checkin_rows', 'set_updated_at_warehouse_inventory_lot', 'sync_completed_checkin_to_inventory', 'update_warehouse_inventory_lot', 'warehouse_inventory_summary']) loop
    execute format('revoke all on function %s from public, anon, authenticated',object.name);
    execute format('grant execute on function %s to service_role',object.name);
  end loop;
end $$;
commit;
