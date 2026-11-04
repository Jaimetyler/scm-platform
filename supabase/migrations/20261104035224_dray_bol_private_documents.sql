insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('savannah-dray-bols','savannah-dray-bols',false,3145728,array['application/pdf']);
create table public.dray_bol_documents (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.dray_import_orders(id),
 mcleod_order text not null check(mcleod_order ~ '^[0-9]{6,7}$'),source_hash text not null,
 bol_bales integer not null check(bol_bales between 1 and 1000),plan_hash text not null check(plan_hash ~ '^[0-9a-f]{64}$'),
 pdf_hash text not null check(pdf_hash ~ '^[0-9a-f]{64}$'),path text not null unique,filename text not null,
 byte_length integer not null check(byte_length between 1 and 3145728),actor text not null,created_at timestamptz not null default now(),
 unique(order_id,source_hash,bol_bales),check(path=mcleod_order||'/'||pdf_hash||'.pdf')
);
alter table public.dray_bol_documents enable row level security;
revoke all on public.dray_bol_documents from public,anon,authenticated;
grant select,insert on public.dray_bol_documents to service_role;
alter table public.dray_bol_images add column document_id uuid references public.dray_bol_documents(id);
