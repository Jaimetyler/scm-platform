-- Trailer belongs to the arrival, not to an additional agreement form.
-- Do not backfill or alter existing immutable signed snapshots.
alter table public.inbound_checkin_rows add column trailer_number text
  check (trailer_number is null or char_length(trailer_number) between 1 and 80);
