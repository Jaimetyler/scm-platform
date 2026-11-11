alter table public.outbound_mcleod_document_uploads
  add column movement_retry_at timestamptz,
  add column movement_retry_actor text,
  add column movement_retry_id text;
