begin;
-- Repair only the observed SCM Houston label misclassification at 5300.
-- A deliberate Keep as source load decision always wins over this correction.
select b.id from public.cotton_outbound_bookings b
where b.terminal='HOU' and b.site_code='5300' and b.status='draft' for update;
create temporary table corrected_houston_source_lines on commit drop as
select l.id,l.booking_id,l.line_status,l.load_source
from public.cotton_outbound_booking_lines l join public.cotton_outbound_bookings b on b.id=l.booking_id
where b.terminal='HOU' and b.site_code='5300' and b.status='draft'
 and l.line_status<>'cancelled' and l.load_source='source_load'
 and upper(trim(l.source_warehouse))='SUPPLY CHAIN MGMT - HOUSTON'
 and l.source_warehouse_code='913054'
 and not exists(select 1 from public.cotton_outbound_mark_events e where e.line_id=l.id and e.action='keep_source');
insert into public.cotton_outbound_mark_events(booking_id,line_id,action,previous_status,previous_source,changed_by,note)
select booking_id,id,'warehouse',line_status,load_source,'SCM classification correction',
 'SCM Houston customer label was incorrectly treated as an outside source because it omitted the street number. Booking is planned through selected warehouse 5300; inventory quantities are unchanged.'
from corrected_houston_source_lines;
update public.cotton_outbound_booking_lines l set load_source='warehouse',status_changed_at=clock_timestamp(),status_changed_by='SCM classification correction'
from corrected_houston_source_lines c where l.id=c.id;
update public.cotton_outbound_source_arrivals a set resolved_at=clock_timestamp(),resolved_by='SCM classification correction'
from corrected_houston_source_lines c where a.line_id=c.id and a.resolved_at is null;
update public.cotton_outbound_bookings b set updated_at=clock_timestamp()
where b.id in (select booking_id from corrected_houston_source_lines);
commit;
