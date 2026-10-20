-- Apply after review, before inviting financial-role staff.
ALTER TABLE public.scm_staff DROP CONSTRAINT IF EXISTS scm_staff_role_check;
ALTER TABLE public.scm_staff ADD CONSTRAINT scm_staff_role_check
  CHECK (role = ANY (ARRAY['admin'::text,'operator'::text,'viewer'::text,'financial'::text]));
