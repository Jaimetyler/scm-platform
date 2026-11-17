begin;
alter table public.scm_staff add column warehouse_level smallint;
alter table public.scm_staff add constraint scm_staff_warehouse_level_check
  check (warehouse_level is null or (role = 'operator' and warehouse_level in (1, 2)));

-- Keep account changes and their warehouse level in the same transaction.
-- The existing administration function checks the administrator and serializes
-- account changes, including protection of the last active administrator.
create function public.scm_manage_staff_access(
  p_actor uuid, p_action text, p_target uuid default null,
  p_email text default null, p_name text default null, p_role text default null,
  p_terminal text default null, p_warehouse_level smallint default null
) returns public.scm_staff
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.scm_staff; actor_email text;
begin
  if p_warehouse_level is not null and (p_role is distinct from 'operator' or p_warehouse_level not in (1,2)) then
    raise exception 'Choose a supported warehouse level';
  end if;
  -- Clear a previous level inside this transaction before changing away from
  -- operator, so the table constraint remains valid during the base function.
  perform pg_advisory_xact_lock(780214);
  if not exists(select 1 from public.scm_staff where id=p_actor and role='admin' and status='active') then
    raise exception 'Administrator access required';
  end if;
  if p_action='access' then
    update public.scm_staff set warehouse_level=null where id=p_target;
  end if;
  result := public.scm_manage_staff(p_actor,p_action,p_target,p_email,p_name,p_role,p_terminal);
  if p_action in ('invite','access') then
    update public.scm_staff
      set warehouse_level=case when p_role='operator' then coalesce(p_warehouse_level,2) else null end,
          updated_at=now()
      where id=result.id returning * into result;
    select email into actor_email from public.scm_staff where id=p_actor;
    insert into public.scm_staff_activity(actor_id,actor_email,action,target)
      values(p_actor,actor_email,'staff:warehouse_level:'||coalesce(result.warehouse_level::text,'none'),result.id::text);
  end if;
  return result;
end $$;
revoke all on function public.scm_manage_staff_access(uuid,text,uuid,text,text,text,text,smallint) from public,anon,authenticated;
grant execute on function public.scm_manage_staff_access(uuid,text,uuid,text,text,text,text,smallint) to service_role;
commit;
