alter table public.inbound_checkin_rows
  add column if not exists bol_photo_path text,
  add column if not exists bol_photo_original_name text,
  add column if not exists bol_photo_content_type text,
  add column if not exists bol_photo_uploaded_at timestamptz,
  add column if not exists movement_direction text not null default 'delivery',
  add column if not exists material_type text not null default 'cotton',
  add column if not exists reference_number text,
  add column if not exists destination text;

alter table public.inbound_checkin_rows
  drop constraint if exists inbound_checkin_rows_movement_direction_check,
  add constraint inbound_checkin_rows_movement_direction_check
    check (movement_direction in ('pickup', 'delivery')),
  drop constraint if exists inbound_checkin_rows_material_type_check,
  add constraint inbound_checkin_rows_material_type_check
    check (material_type in ('cotton', 'lumber', 'other'));

-- Enforce the McLeod boundary in the database as well as the application.
-- Even if a non-cotton or pickup row were accidentally marked ready, the
-- atomic claim cannot move it into processing.
create or replace function public.claim_inbound_checkin_row(p_id uuid)
returns setof public.inbound_checkin_rows
language plpgsql
security invoker
as $$
begin
  return query
    update public.inbound_checkin_rows
       set draft_status = 'processing', processing_error = null
     where id = p_id
       and draft_status = 'ready'
       and movement_direction = 'delivery'
       and material_type = 'cotton'
     returning *;
end;
$$;

-- BOL images are private. They are read only through the authenticated
-- warehouse API, which creates a short-lived signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-bol-documents',
  'driver-bol-documents',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
