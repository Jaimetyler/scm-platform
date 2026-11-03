-- Allow a fenced repair only for an order demonstrably created by this importer.
create or replace function public.transition_dray_import(p_id uuid,p_version integer,p_from text,p_to text,p_order text,p_note text,p_actor text)
returns setof public.dray_import_orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.dray_import_orders;
begin
 if not ((p_from='blocked' and p_to='rating') or (p_from='verified' and p_to='delivering') or (p_from='delivering' and p_to in ('delivered','delivery_uncertain')) or (p_from='delivery_uncertain' and p_to in ('delivered','delivery_uncertain')) or (p_from='preview_blocked' and p_to in ('ready','preview_blocked','verified')) or (p_from='ready' and p_to='creating') or (p_from='creating' and p_to in ('ready','blocked','creation_uncertain','created','verified')) or
 (p_from='created' and p_to in ('rating','blocked','verified')) or (p_from='rating' and p_to in ('created','blocked','rating_uncertain','verified')) or
 (p_from in ('creation_uncertain','rating_uncertain','blocked') and p_to in ('blocked','verified'))) then raise exception 'Invalid import state transition';end if;
 if p_from='blocked' and p_to='rating' and not exists(
 select 1 from public.dray_import_events e join public.dray_import_orders o on o.id=e.order_id
 where o.id=p_id and e.to_state='created' and e.order_number=o.order_id and o.order_id is not null
 ) then raise exception 'Repair requires an importer creation receipt'; end if;
 update public.dray_import_orders set status=p_to,order_id=coalesce(p_order,order_id),note=left(p_note,2000),version=version+1,updated_at=clock_timestamp()
 where id=p_id and version=p_version and status=p_from returning * into saved;
 if saved.id is null then return;end if;
 insert into public.dray_import_events(order_id,actor,from_state,to_state,order_number,note) values(saved.id,p_actor,p_from,p_to,saved.order_id,saved.note);
 return next saved;
end $$;
