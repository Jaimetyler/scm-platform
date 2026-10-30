begin;
alter table public.inbound_checkin_rows
  add column if not exists local_receiving_only boolean not null default false;
-- Preserve intent of existing manually flagged records; don't infer from an
-- incomplete lookup or a generic unmatched order.
update public.inbound_checkin_rows
set local_receiving_only = true
where matched_order_id is null
  and position('local receiving only, reconcile before any McLeod update.' in coalesce(comment_1,'')) > 0;
commit;
