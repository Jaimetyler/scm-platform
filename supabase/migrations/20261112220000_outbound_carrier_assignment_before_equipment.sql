alter table public.cotton_outbound_containers
  drop constraint outbound_carrier_plan_requires_equipment,
  add constraint outbound_carrier_plan_requires_load check (
    carrier_plan is null or (
      split_transfer_id is null and (booking_line_id is not null or container_number is not null)
    )
  );
