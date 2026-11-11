alter table public.cotton_outbound_bookings
  drop constraint cotton_outbound_bookings_status_check,
  add constraint cotton_outbound_bookings_status_check
    check (status in ('draft', 'archived', 'cancelled'));
