create table public.outbound_field_changes (
  row_id uuid not null,
  field text not null,
  changed_at timestamptz not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE'))
);

create index outbound_field_changes_latest_idx
  on public.outbound_field_changes (row_id, field, changed_at desc);

alter table public.outbound_field_changes enable row level security;
revoke all on public.outbound_field_changes from public, anon, authenticated, service_role;
grant select, insert on public.outbound_field_changes to service_role;

create function public.log_outbound_field_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  edit_time timestamptz := pg_catalog.clock_timestamp();
begin
  insert into public.outbound_field_changes (row_id, field, changed_at, operation)
  select coalesce(new.id, old.id), entry.key, edit_time, tg_op
  from pg_catalog.jsonb_each(coalesce(new_row, old_row)) entry
  where entry.key not in ('id', 'created_at', 'updated_at', 'updated_by')
    and case tg_op
      when 'UPDATE' then old_row -> entry.key is distinct from entry.value
      else entry.value <> 'null'::jsonb
    end;
  return null;
end;
$$;

revoke execute on function public.log_outbound_field_changes() from public, anon, authenticated;
grant execute on function public.log_outbound_field_changes() to service_role;

create trigger log_outbound_booking_fields
after insert or update or delete on public.cotton_outbound_bookings
for each row execute function public.log_outbound_field_changes();

create trigger log_outbound_container_fields
after insert or update or delete on public.cotton_outbound_containers
for each row execute function public.log_outbound_field_changes();

create trigger log_outbound_booking_line_fields
after insert or update or delete on public.cotton_outbound_booking_lines
for each row execute function public.log_outbound_field_changes();

create function public.outbound_field_timestamps(p_row_ids uuid[])
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_object_agg(row_id, fields), '{}'::jsonb)
  from (
    select row_id, pg_catalog.jsonb_object_agg(field, changed_at) as fields
    from (
      select distinct on (row_id, field) row_id, field, changed_at
      from public.outbound_field_changes
      where row_id = any(p_row_ids)
      order by row_id, field, changed_at desc
    ) latest
    group by row_id
  ) rows;
$$;

revoke execute on function public.outbound_field_timestamps(uuid[]) from public, anon, authenticated;
grant execute on function public.outbound_field_timestamps(uuid[]) to service_role;
