create function public.search_warehouse_operations(p_query text,p_terminal text default null,p_site text default null)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare needle text:=lower(trim(p_query)); result jsonb;
begin
 if needle is null or length(needle) not between 2 and 100 or (p_terminal is not null and p_terminal not in ('HOU','SAV','DAL'))
  or (p_site is not null and p_terminal is null) then raise exception 'Enter 2-100 characters and a valid warehouse scope' using errcode='22023';end if;
 select jsonb_build_object(
 'inventory',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select i.id,i.terminal,i.site_code,i.site_name,i.mark title,concat_ws(' · ',i.customer,nullif(i.shipping_order,''),i.warehouse_location) subtitle,
   i.inventory_status status,i.current_bales quantity,i.source_type kind,i.received_date date
  from public.warehouse_inventory_lots i where (p_terminal is null or i.terminal=p_terminal) and (p_site is null or i.site_code=p_site)
   and strpos(lower(concat_ws(' ',i.mark,i.customer,i.shipping_order,i.booking_number,i.warehouse_location)),needle)>0
  order by (lower(i.mark)=needle) desc,i.received_date desc nulls last,i.id limit 26) r),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select b.id,b.terminal,b.site_code,b.site_name,b.booking_number title,concat_ws(' · ',b.customer,b.scm_file_number,b.customer_reference) subtitle,
   b.status,b.requested_bales quantity,b.source_format kind,b.cutoff date,
   array(select l.mark from public.cotton_outbound_booking_lines l where l.booking_id=b.id order by l.source_row limit 8) marks,
   array(select c.container_number from public.cotton_outbound_containers c where c.booking_id=b.id and strpos(lower(concat_ws(' ',c.container_number,c.seal_number,c.chassis_number)),needle)>0 order by c.sequence_no limit 8) containers
  from public.cotton_outbound_bookings b where (p_terminal is null or b.terminal=p_terminal) and (p_site is null or b.site_code=p_site)
   and (strpos(lower(concat_ws(' ',b.booking_number,b.customer,b.customer_reference,b.scm_file_number)),needle)>0
    or exists(select 1 from public.cotton_outbound_booking_lines l where l.booking_id=b.id and strpos(lower(concat_ws(' ',l.mark,l.shipping_order)),needle)>0)
    or exists(select 1 from public.cotton_outbound_containers c where c.booking_id=b.id and strpos(lower(concat_ws(' ',c.container_number,c.seal_number,c.chassis_number)),needle)>0))
  order by (lower(b.booking_number)=needle) desc,b.updated_at desc,b.id limit 26) r),'[]'::jsonb),
 'checkins',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select r.id,r.terminal,r.site_code,r.site_name,coalesce(nullif(r.mark,''),nullif(r.reference_number,''),r.driver_name,'Check-in') title,
   concat_ws(' · ',r.reference_number,r.shipper,r.trucking_company,r.driver_name,r.matched_order_id,r.movement_direction) subtitle,
   coalesce(r.yard_status,r.draft_status) status,r.bale_count quantity,r.material_type kind,r.checked_in_at date
  from public.inbound_checkin_rows r where r.checked_in_at is not null and (p_terminal is null or r.terminal=p_terminal) and (p_site is null or r.site_code=p_site)
   and strpos(lower(concat_ws(' ',r.mark,r.reference_number,r.shipper,r.driver_name,r.trucking_company,r.matched_order_id,r.trailer_number)),needle)>0
  order by r.checked_in_at desc,r.id limit 26) r),'[]'::jsonb),
 'containerArrivals',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select c.id,c.terminal,c.site_code,c.site_name,c.driver_name title,'Container check-in'::text subtitle,c.queue_status status,
   c.checked_in_at date from public.container_gate_queue c
  where (p_terminal is null or c.terminal=p_terminal) and (p_site is null or c.site_code=p_site) and strpos(lower(c.driver_name),needle)>0
  order by c.checked_in_at desc,c.id limit 26) r),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.search_warehouse_operations(text,text,text) from public,anon,authenticated;
grant execute on function public.search_warehouse_operations(text,text,text) to service_role;
notify pgrst,'reload schema';
