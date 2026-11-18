update public.inbound_transit_rates
set delivery_code = 'SUPPPOG4'
where customer_code = 'ALLECOTN'
  and delivery_city = 'PORT WENTWORTH' and delivery_state = 'GA'
  and delivery_code is null;

create or replace view public.inbound_transit_rates_with_miles
with (security_invoker = true) as
select r.*, m.miles as contract_miles
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
