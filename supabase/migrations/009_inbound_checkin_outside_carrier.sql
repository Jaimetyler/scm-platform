-- Run before deploying outside-carrier classification.
alter table public.inbound_checkin_rows
  drop constraint if exists inbound_checkin_rows_draft_status_check;

alter table public.inbound_checkin_rows
  add constraint inbound_checkin_rows_draft_status_check
  check (draft_status in ('checked_in', 'ready', 'processing', 'processed',
                         'outside_carrier', 'failed', 'draft'));
