create or replace view v_latest_pnl_uploads as
select u.*
from pnl_uploads u
join (
  select
    report_month,
    max(created_at) as max_created_at
  from pnl_uploads
  where report_month is not null
  group by report_month
) latest
  on u.report_month = latest.report_month
 and u.created_at = latest.max_created_at;