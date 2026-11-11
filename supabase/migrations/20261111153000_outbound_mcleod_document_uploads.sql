create table public.outbound_mcleod_document_uploads (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  mcleod_order text not null check (mcleod_order ~ '^[0-9]{6,7}$'),
  document_slot text not null check (document_slot in ('bol','ingate','outgate')),
  document_type text not null check (
    (document_slot = 'bol' and document_type = '01') or
    (document_slot in ('ingate','outgate') and document_type = '05')
  ),
  filename text not null,
  pdf_hash text not null check (length(pdf_hash) = 64),
  status text not null check (status in ('sending','staged','verified','uncertain')),
  receipt text,
  actor text not null,
  created_at timestamptz not null default now(),
  unique (mcleod_order, document_slot),
  unique (mcleod_order, document_type, pdf_hash)
);
alter table public.outbound_mcleod_document_uploads enable row level security;
revoke all on public.outbound_mcleod_document_uploads from public, anon, authenticated;
grant select, insert, update on public.outbound_mcleod_document_uploads to service_role;
