create table if not exists public.cotton_bunge_import_orders (
 id uuid primary key default gen_random_uuid(),
 source_hash text not null unique,
 sales_order text not null,
 blnum text not null,
 customer_id text not null default 'BUNGOMNE',
 revenue_code text not null default 'MAIN',
 destination_code text not null,
 source_filename text not null,
 original_pickups jsonb not null,
 reviewed_payload jsonb,
 status text not null default 'previewed' check (status in ('previewed','ready','creating','creation_uncertain','created','verified','blocked')),
 mcleod_order_id text,
 error_message text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint cotton_bunge_source_valid check (length(source_hash)=64)
);
create unique index if not exists cotton_bunge_one_order_per_reference
on public.cotton_bunge_import_orders(customer_id,revenue_code,blnum);
alter table public.cotton_bunge_import_orders enable row level security;
revoke all on public.cotton_bunge_import_orders from anon,authenticated;
