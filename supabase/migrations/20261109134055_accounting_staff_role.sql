begin;
-- Preserve the existing legacy financial role while adding the supported Accounting role.
alter table public.scm_staff drop constraint scm_staff_role_check;
alter table public.scm_staff add constraint scm_staff_role_check
  check (role in ('admin','operator','viewer','financial','accounting'));
-- Financial reports must be reachable only through the role-checked server API.
do $$ begin
  if to_regclass('public.v_pnl_monthly_entity_totals') is not null then
    revoke all on public.v_pnl_monthly_entity_totals from public, anon, authenticated;
    grant select on public.v_pnl_monthly_entity_totals to service_role;
  end if;
end $$;
commit;
