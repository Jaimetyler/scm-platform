alter table public.customer_service_rates
  add column chassis_split_rate numeric(12,2) check (chassis_split_rate >= 0),
  add column stopoff_rate numeric(12,2) check (stopoff_rate >= 0);

update public.outbound_carrier_rates
set rates = rates #- '{base,bill}' #- '{chassisDays,bill}' #- '{chassisSplits,bill}' #- '{stopoffs,bill}';

update public.cotton_outbound_containers
set carrier_plan = carrier_plan #- '{rate,rates,base,bill}' #- '{rate,rates,chassisDays,bill}'
  #- '{rate,rates,chassisSplits,bill}' #- '{rate,rates,stopoffs,bill}'
where carrier_plan is not null;
