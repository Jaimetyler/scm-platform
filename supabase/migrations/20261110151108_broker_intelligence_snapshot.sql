create table public.broker_intelligence_snapshots (
  id text primary key check (id = 'current'),
  payload jsonb not null check (payload->>'version' = '1' and jsonb_typeof(payload->'rows') = 'array'),
  source_name text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);
alter table public.broker_intelligence_snapshots enable row level security;
revoke all on public.broker_intelligence_snapshots from public, anon, authenticated, service_role;
grant select, insert, update on public.broker_intelligence_snapshots to service_role;
