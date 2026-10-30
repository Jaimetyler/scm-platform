create table if not exists public.inbound_checkin_rows (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now(),

  terminal text not null check (terminal in ('SAV', 'HOU')),
  site_code text not null,
  site_name text not null,
  sub_location text not null default 'MAIN',

  received_date date,
  mark text,
  shipper text,
  bale_count integer,
  warehouse_location text,
  equipment_type text check (equipment_type is null or equipment_type in ('V', 'F')),
  verified boolean not null default false,

  comment_1 text,
  comment_2 text,

  draft_status text not null default 'draft' check (draft_status in ('draft', 'ready', 'processed')),
  processed_at timestamptz
);

create index if not exists idx_inbound_checkin_rows_site
  on public.inbound_checkin_rows (terminal, site_code);

create index if not exists idx_inbound_checkin_rows_status
  on public.inbound_checkin_rows (draft_status, received_date desc, created_at desc);

create or replace function public.set_updated_at_inbound_checkin_rows()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.last_saved_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_inbound_checkin_rows on public.inbound_checkin_rows;

create trigger trg_set_updated_at_inbound_checkin_rows
before update on public.inbound_checkin_rows
for each row
execute function public.set_updated_at_inbound_checkin_rows();