alter table public.cotton_outbound_containers
  drop constraint outbound_carrier_plan_requires_load,
  add constraint outbound_carrier_plan_requires_active_slot
    check (carrier_plan is null or split_transfer_id is null);

create function public.guard_outbound_carrier_load()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.carrier_plan is not null and new.booking_line_id is null and new.container_number is null
    and not exists (
      select 1 from public.dallas_dray_import_loads
      where booking_id = new.booking_id and sequence_no = new.sequence_no
        and state = 'verified' and order_id is not null
    ) then
    raise check_violation using message = 'Assign a mark, container number, or verified SCM order before saving a carrier';
  end if;
  return new;
end;
$$;

create trigger trg_guard_outbound_carrier_load
before insert or update on public.cotton_outbound_containers
for each row execute function public.guard_outbound_carrier_load();
