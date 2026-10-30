-- Additive only. Preserve the original driver-entered lookup value independently
-- of the canonical McLeod reference used by existing queue/checkout workflows.
-- No historical guesses or backfill. Deploy before the unified QR application.
ALTER TABLE public.inbound_checkin_rows ADD COLUMN IF NOT EXISTS driver_lookup_input text;
ALTER TABLE public.inbound_checkin_rows ADD CONSTRAINT inbound_checkin_driver_lookup_input_length
  CHECK (driver_lookup_input IS NULL OR length(driver_lookup_input) BETWEEN 3 AND 120) NOT VALID;
COMMENT ON COLUMN public.inbound_checkin_rows.driver_lookup_input IS
  'Original trimmed QR driver input, preserving case; may be an SCM order number or pickup/delivery reference. Canonical order/reference/stop are stored separately.';
