-- The original source key/hash remains the upload and BOL identity.
create unique index dray_import_effective_container_key
  on public.dray_import_orders (terminal, location, (invoice->>'shippingOrder'), (invoice->>'container'))
  where invoice ? 'shippingOrder' and invoice ? 'container';

create function public.review_savannah_dray_import(p_id uuid,p_version integer,p_invoice jsonb,p_actor text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare original public.dray_import_orders;
begin
  select * into original from public.dray_import_orders
  where id=p_id and version=p_version and terminal='SAV' and status='preview_blocked' and order_id is null
  for update;
  if not found then return false; end if;
  if original.invoice->>'sourceKey' is distinct from p_invoice->>'sourceKey'
    or original.invoice->>'shippingOrder' is distinct from p_invoice->>'shippingOrder'
    or p_invoice->'inputErrors' is distinct from '[]'::jsonb then
    raise exception 'Invalid dray correction';
  end if;
  update public.dray_import_orders set invoice=p_invoice, status='ready', version=version+1,
    note='Reviewed source correction; McLeod duplicate search clear.', updated_at=clock_timestamp()
  where id=p_id;
  insert into public.dray_import_events(order_id,actor,from_state,to_state,note)
  values(p_id,p_actor,'preview_blocked','ready',jsonb_build_object(
    'previousContainer',original.invoice->>'container','container',p_invoice->>'container',
    'previousBooking',original.invoice->>'booking','booking',p_invoice->>'booking',
    'previousCarrierCents',original.invoice->'carrierCents','carrierCents',p_invoice->'carrierCents'
  )::text);
  return true;
end $$;
revoke all on function public.review_savannah_dray_import(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.review_savannah_dray_import(uuid,integer,jsonb,text) to service_role;
