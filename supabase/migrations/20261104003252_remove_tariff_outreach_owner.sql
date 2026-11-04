-- Retain the unused column for compatibility with the existing audited save RPC.
-- Identity comes from authenticated audit actors, not an assigned owner.
alter table public.cotton_tariff_outreach alter column owner set default '';
with previous as materialized (
 select * from public.cotton_tariff_outreach where owner<>'' for update
), updated as (
 update public.cotton_tariff_outreach q set owner='',version=q.version+1,updated_at=clock_timestamp()
 from previous p where q.location_id=p.location_id returning q.*
)
insert into public.cotton_tariff_outreach_events(location_id,action,actor,before_value,after_value)
select u.location_id,'owner_field_retired','Codex; removal authorized by Jaime Tyler',to_jsonb(p),to_jsonb(u)
from updated u join previous p using(location_id);
