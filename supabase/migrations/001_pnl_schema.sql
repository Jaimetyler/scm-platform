create extension if not exists pgcrypto;

create table if not exists pnl_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  report_month date,
  source_sheet text,
  uploaded_by uuid,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists pnl_raw_rows (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  row_number integer not null,
  account_number text,
  description text,
  current_period numeric(14,2),
  year_to_date numeric(14,2),
  source_sheet text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pnl_raw_rows_upload_id
  on pnl_raw_rows(upload_id);

create index if not exists idx_pnl_raw_rows_account_number
  on pnl_raw_rows(account_number);

create table if not exists pnl_classified_rows (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  raw_row_id uuid not null references pnl_raw_rows(id) on delete cascade,
  row_number integer not null,
  account_number text,
  description text,
  current_period numeric(14,2),
  year_to_date numeric(14,2),
  entity text not null,
  section text not null,
  rule_applied text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pnl_classified_rows_upload_id
  on pnl_classified_rows(upload_id);

create index if not exists idx_pnl_classified_rows_entity
  on pnl_classified_rows(entity);

create index if not exists idx_pnl_classified_rows_section
  on pnl_classified_rows(section);

create table if not exists pnl_rule_log (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  raw_row_id uuid not null references pnl_raw_rows(id) on delete cascade,
  account_number text,
  description text,
  rule_name text not null,
  from_entity text,
  to_entity text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pnl_rule_log_upload_id
  on pnl_rule_log(upload_id);

create index if not exists idx_pnl_rule_log_raw_row_id
  on pnl_rule_log(raw_row_id);