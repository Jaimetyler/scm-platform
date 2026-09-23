create table if not exists public.driver_checkin_sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal text not null check (terminal in ('SAV', 'HOU')),
  site_code text not null,
  site_name text not null,
  public_token uuid not null default gen_random_uuid(),
  latitude double precision,
  longitude double precision,
  radius_m integer not null default 500 check (radius_m between 25 and 5000),
  active boolean not null default false,
  unique (terminal, site_code),
  unique (public_token),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create index if not exists idx_driver_checkin_sites_public_token
  on public.driver_checkin_sites (public_token);

insert into public.driver_checkin_sites (terminal, site_code, site_name)
values
  ('SAV', '1701', 'Savannah - 1701'),
  ('SAV', '246', 'Savannah - 246'),
  ('SAV', '984', 'Savannah - 984'),
  ('SAV', '175', 'Savannah - 175'),
  ('HOU', '5300', 'Houston - 5300')
on conflict (terminal, site_code) do update set site_name = excluded.site_name;

alter table public.inbound_checkin_rows
  add column if not exists checkin_source text not null default 'staff'
    check (checkin_source in ('staff', 'driver_qr')),
  add column if not exists driver_checkin_site_id uuid
    references public.driver_checkin_sites(id) on delete set null,
  add column if not exists driver_name text,
  add column if not exists driver_phone text,
  add column if not exists trucking_company text,
  add column if not exists driver_latitude double precision,
  add column if not exists driver_longitude double precision,
  add column if not exists driver_accuracy_m double precision,
  add column if not exists driver_distance_m double precision,
  add column if not exists gate_location_verified_at timestamptz;

create or replace function public.set_updated_at_driver_checkin_sites()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_driver_checkin_sites on public.driver_checkin_sites;
create trigger trg_set_updated_at_driver_checkin_sites
before update on public.driver_checkin_sites
for each row execute function public.set_updated_at_driver_checkin_sites();
