alter table public.cotton_location_master
  add column if not exists dallas_tariff_planning_note text;

comment on column public.cotton_location_master.dallas_tariff_planning_note is
  'Dallas warehouse tariff worksheet column L, used as informational McLeod order planning text.';
