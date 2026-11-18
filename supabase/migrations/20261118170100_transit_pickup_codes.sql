create or replace view public.inbound_transit_rates_with_miles
with (security_invoker = true) as
select r.*, m.miles as contract_miles,
  array(select distinct l.mcleod_code from public.cotton_location_master l
    where upper(btrim(l.city)) = r.pickup_city and upper(btrim(l.state)) = r.pickup_state
      and nullif(btrim(l.mcleod_code), '') is not null order by l.mcleod_code) as pickup_codes
from public.inbound_transit_rates r
left join lateral (
  select min(cm.miles) as miles
  from public.inbound_contract_miles cm
  where cm.customer_code = r.customer_code
    and cm.pickup_city = r.pickup_city
    and cm.pickup_state = r.pickup_state
    and (r.customer_code = 'ALLECOTN' or cm.delivery_code = r.delivery_code)
  having min(cm.miles) = max(cm.miles)
) m on true;
