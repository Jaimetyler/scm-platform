-- Private, versioned financial snapshot; no client-role access.
create table public.scm_reporting_snapshots (
 id text primary key,
 customers jsonb not null check(jsonb_typeof(customers) = 'array'),
 source_date date not null,
 source_sha256 text not null check(length(source_sha256) = 64),
 created_at timestamptz not null default now()
);
alter table public.scm_reporting_snapshots enable row level security;
revoke all on public.scm_reporting_snapshots from public, anon, authenticated;
grant select, insert on public.scm_reporting_snapshots to service_role;
