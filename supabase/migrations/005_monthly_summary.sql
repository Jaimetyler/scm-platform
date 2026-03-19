create or replace view v_pnl_monthly_summary as
select
  u.report_month,
  c.entity,

  -- CURRENT
  sum(case when c.section = 'Income' then coalesce(c.current_period, 0) else 0 end) as current_income,
  sum(case when c.section = 'Expense' then coalesce(c.current_period, 0) else 0 end) as current_expense,
  sum(
    case
      when c.section = 'Income' then coalesce(c.current_period, 0)
      when c.section = 'Expense' then -coalesce(c.current_period, 0)
      else 0
    end
  ) as current_net,

  -- YTD
  sum(case when c.section = 'Income' then coalesce(c.year_to_date, 0) else 0 end) as ytd_income,
  sum(case when c.section = 'Expense' then coalesce(c.year_to_date, 0) else 0 end) as ytd_expense,
  sum(
    case
      when c.section = 'Income' then coalesce(c.year_to_date, 0)
      when c.section = 'Expense' then -coalesce(c.year_to_date, 0)
      else 0
    end
  ) as ytd_net

from public.pnl_classified_rows c
join public.pnl_uploads u
  on c.upload_id = u.id

group by
  u.report_month,
  c.entity

order by
  u.report_month,
  c.entity;