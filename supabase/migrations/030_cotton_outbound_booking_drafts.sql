-- Booking requests are drafts. Importing never changes cotton inventory.
create table if not exists public.cotton_outbound_bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  terminal text not null check (terminal in ('SAV', 'HOU')),
  site_code text not null,
  site_name text not null,
  customer text not null,
  booking_number text not null,
  customer_reference text,
  planned_containers integer check (planned_containers > 0),
  requested_bales integer not null check (requested_bales > 0),
  status text not null default 'draft' check (status in ('draft', 'cancelled')),
  source_format text not null default 'bunge_booking_request',
  source_filename text not null,
  unique (terminal, site_code, booking_number)
);
create table if not exists public.cotton_outbound_booking_lines (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.cotton_outbound_bookings(id) on delete cascade,
  source_row integer not null,
  mark text not null,
  requested_bales integer not null check (requested_bales > 0),
  load_by date not null,
  date_confirmed boolean not null default false,
  shipping_order text,
  source_warehouse_code text,
  source_warehouse text not null,
  unique (booking_id, source_row)
);
create index if not exists idx_cotton_outbound_booking_lines_mark
  on public.cotton_outbound_booking_lines (mark);

create or replace function public.create_cotton_outbound_booking_draft(
  p_terminal text, p_site_code text, p_site_name text, p_customer text,
  p_booking_number text, p_customer_reference text, p_containers integer,
  p_total_bales integer, p_source_filename text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_line jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 500 then raise exception 'Invalid booking lines'; end if;
  if p_total_bales <> (select sum((line->>'bales')::integer) from jsonb_array_elements(p_lines) line)
     then raise exception 'Booking bale total does not match its lines'; end if;
  insert into public.cotton_outbound_bookings
    (terminal, site_code, site_name, customer, booking_number, customer_reference,
     planned_containers, requested_bales, source_filename)
  values (p_terminal, p_site_code, p_site_name, p_customer, p_booking_number,
    nullif(p_customer_reference, ''), p_containers, p_total_bales, p_source_filename)
  returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.cotton_outbound_booking_lines
      (booking_id, source_row, mark, requested_bales, load_by, date_confirmed, shipping_order, source_warehouse_code, source_warehouse)
    values (v_id, (v_line->>'sourceRow')::integer, v_line->>'mark',
      (v_line->>'bales')::integer, (v_line->>'loadBy')::date,
      (v_line->>'confirmed')::boolean, nullif(v_line->>'shippingOrder', ''), nullif(v_line->>'warehouseCode', ''), v_line->>'warehouse');
  end loop;
  return v_id;
end;
$$;

-- These endpoints use the server-side service role. Do not expose drafts via direct client SQL.
revoke all on public.cotton_outbound_bookings from anon, authenticated;
revoke all on public.cotton_outbound_booking_lines from anon, authenticated;
revoke all on function public.create_cotton_outbound_booking_draft(text,text,text,text,text,text,integer,integer,text,jsonb) from public, anon, authenticated;
grant select, insert, update, delete on public.cotton_outbound_bookings to service_role;
grant select, insert, update, delete on public.cotton_outbound_booking_lines to service_role;
grant execute on function public.create_cotton_outbound_booking_draft(text,text,text,text,text,text,integer,integer,text,jsonb) to service_role;
