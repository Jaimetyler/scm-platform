-- Run this before deploying the revised check-in page and routes.
alter table public.inbound_checkin_rows
  drop constraint if exists inbound_checkin_rows_draft_status_check;

alter table public.inbound_checkin_rows
  add constraint inbound_checkin_rows_draft_status_check
  check (draft_status in ('checked_in', 'ready', 'processing', 'processed', 'failed', 'draft'));

alter table public.inbound_checkin_rows
  add column if not exists bol_bc integer,
  add column if not exists processing_error text,
  add column if not exists matched_order_id text;

-- Claim a ready row atomically before any McLeod call. A concurrent request
-- receives no row and therefore cannot start a second delivery attempt.
create or replace function public.claim_inbound_checkin_row(p_id uuid)
returns setof public.inbound_checkin_rows
language plpgsql
security invoker
as $$
begin
  return query
    update public.inbound_checkin_rows
       set draft_status = 'processing', processing_error = null
     where id = p_id and draft_status = 'ready'
     returning *;
end;
$$;
