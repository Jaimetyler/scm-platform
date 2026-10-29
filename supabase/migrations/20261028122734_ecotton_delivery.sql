-- Preserve existing ledger rows, permissions and audit events.
alter table public.ecotton_import_orders drop constraint ecotton_import_orders_status_check;
alter table public.ecotton_import_orders add constraint ecotton_import_orders_status_check check(status in ('ready','preview_blocked','blocked','creating','creation_uncertain','created','rating','rating_uncertain','verified','delivering','delivery_uncertain','delivered'));
create or replace function public.transition_ecotton_import(p_id uuid,p_version integer,p_from text,p_to text,p_order text,p_note text,p_actor text)
returns setof public.ecotton_import_orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.ecotton_import_orders;
begin
 if not ((p_from='verified' and p_to='delivering') or (p_from='delivering' and p_to in ('delivered','delivery_uncertain')) or (p_from='delivery_uncertain' and p_to in ('delivered','delivery_uncertain')) or (p_from='preview_blocked' and p_to in ('ready','preview_blocked','verified')) or (p_from='ready' and p_to='creating') or (p_from='creating' and p_to in ('ready','blocked','creation_uncertain','created','verified')) or
 (p_from='created' and p_to in ('rating','blocked','verified')) or (p_from='rating' and p_to in ('created','blocked','rating_uncertain','verified')) or
 (p_from in ('creation_uncertain','rating_uncertain','blocked') and p_to in ('blocked','verified'))) then raise exception 'Invalid import state transition';end if;
 update public.ecotton_import_orders set status=p_to,order_id=coalesce(p_order,order_id),note=left(p_note,2000),version=version+1,updated_at=clock_timestamp()
 where id=p_id and version=p_version and status=p_from returning * into saved;
 if saved.id is null then return;end if;
 insert into public.ecotton_import_events(order_id,actor,from_state,to_state,order_number,note) values(saved.id,p_actor,p_from,p_to,saved.order_id,saved.note);
 return next saved;
end $$;
