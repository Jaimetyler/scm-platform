-- Yard progress is separate from McLeod processing status. Recent QR arrivals
-- become waiting; staff-entered cotton rows do not enter this queue.
alter table public.inbound_checkin_rows
  add column if not exists yard_status text,
  add column if not exists yard_called_at timestamptz,
  add column if not exists yard_in_door_at timestamptz,
  add column if not exists yard_work_started_at timestamptz,
  add column if not exists yard_completed_at timestamptz,
  add column if not exists yard_updated_by text;

alter table public.inbound_checkin_rows
  drop constraint if exists inbound_checkin_rows_yard_status_check,
  add constraint inbound_checkin_rows_yard_status_check
    check (yard_status in ('waiting', 'called', 'in_door', 'working', 'completed', 'cancelled'));

-- Do not surface old pilot check-ins as trucks waiting today.
update public.inbound_checkin_rows
set yard_status = case
  when checked_in_at >= now() - interval '24 hours' then 'waiting'
  else 'completed'
end
where checkin_source = 'driver_qr' and yard_status is null;

create index if not exists idx_inbound_checkin_yard_queue
  on public.inbound_checkin_rows (terminal, site_code, checked_in_at)
  where checkin_source = 'driver_qr' and yard_status in ('waiting', 'called', 'in_door', 'working');
