begin;
create or replace function public.scm_manage_staff(p_actor uuid, p_action text, p_target uuid default null,
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
    if p_action='resend' and result.status in ('pending','disabled') then
      update public.scm_staff set status='pending', invite_expires_at=now()+interval '7 days', invited_at=now(),updated_at=now()
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

commit;
