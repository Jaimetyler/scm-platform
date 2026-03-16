create or replace view v_pnl_monthly_summary as
select
  u.report_month,
  c.entity,

  sum(
    case
      when c.section = 'Income' then coalesce(c.current_period,0)
      else 0
    end
  ) as income,

  sum(
    case
      when c.section = 'Expense' then coalesce(c.current_period,0)
      else 0
    end
  ) as expense,

  sum(
    case
      when c.section = 'Income' then coalesce(c.current_period,0)
      when c.section = 'Expense' then -coalesce(c.current_period,0)
      else 0
    end
  ) as net

from pnl_classified_rows c
join v_latest_pnl_uploads u
  on c.upload_id = u.id

group by
  u.report_month,
  c.entity

order by
  u.report_month,
  c.entity;