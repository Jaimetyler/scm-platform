-- The arrival clock starts only after mark, customer, and BOL B/C are entered.
-- created_at continues to record when the shared row first appeared.
alter table public.inbound_checkin_rows
  add column if not exists checked_in_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists identity_corrected_at timestamptz;
