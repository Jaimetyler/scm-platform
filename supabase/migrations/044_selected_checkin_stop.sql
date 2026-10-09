-- Additive only. Existing records remain unbound until a fresh unique yard/direction lookup.
-- No historical stop guessing or backfill is performed.
ALTER TABLE public.inbound_checkin_rows ADD COLUMN IF NOT EXISTS matched_stop_id text;
ALTER TABLE public.inbound_checkin_rows ADD CONSTRAINT inbound_checkin_stop_requires_order
  CHECK (matched_stop_id IS NULL OR (matched_order_id IS NOT NULL AND length(matched_stop_id) BETWEEN 1 AND 100)) NOT VALID;
COMMENT ON COLUMN public.inbound_checkin_rows.matched_stop_id IS
  'Exact McLeod yard and direction stop selected and revalidated by the application; never inferred from list order.';

-- A changed order/yard/direction invalidates a prior stop selection unless the
-- application supplied a different freshly validated selection in this write.
CREATE OR REPLACE FUNCTION public.clear_stale_checkin_stop() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.matched_order_id IS NULL THEN NEW.matched_stop_id := NULL;
  ELSIF (NEW.matched_order_id, NEW.terminal, NEW.site_code, NEW.movement_direction)
      IS DISTINCT FROM (OLD.matched_order_id, OLD.terminal, OLD.site_code, OLD.movement_direction)
      AND NEW.matched_stop_id IS NOT DISTINCT FROM OLD.matched_stop_id THEN
    NEW.matched_stop_id := NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER clear_stale_checkin_stop BEFORE UPDATE ON public.inbound_checkin_rows
FOR EACH ROW EXECUTE FUNCTION public.clear_stale_checkin_stop();
REVOKE ALL ON FUNCTION public.clear_stale_checkin_stop() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_stale_checkin_stop() TO service_role;
