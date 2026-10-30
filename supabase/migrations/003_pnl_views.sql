create or replace view v_pnl_summary_by_entity as
select
  c.upload_id,
  u.report_month,
  c.entity,
  sum(case when c.section = 'Income' then coalesce(c.current_period, 0) else 0 end) as current_income,
  sum(case when c.section = 'Expense' then coalesce(c.current_period, 0) else 0 end) as current_expense,
  sum(
    case
      when c.section = 'Income' then coalesce(c.current_period, 0)
      when c.section = 'Expense' then -coalesce(c.current_period, 0)
      else 0
    end
  ) as current_net,
  sum(case when c.section = 'Income' then coalesce(c.year_to_date, 0) else 0 end) as ytd_income,
  sum(case when c.section = 'Expense' then coalesce(c.year_to_date, 0) else 0 end) as ytd_expense,
  sum(
    case
      when c.section = 'Income' then coalesce(c.year_to_date, 0)
      when c.section = 'Expense' then -coalesce(c.year_to_date, 0)
      else 0
    end
  ) as ytd_net
from pnl_classified_rows c
join pnl_uploads u on u.id = c.upload_id
group by c.upload_id, u.report_month, c.entity;

create or replace view v_pnl_detail_lines as
select
  c.upload_id,
  u.report_month,
  c.entity,
  c.section,
  c.account_number,
  c.description,
  c.current_period,
  c.year_to_date,
  c.rule_applied
from pnl_classified_rows c
join pnl_uploads u on u.id = c.upload_id;

create or replace view v_pnl_exceptions as
select
  c.upload_id,
  u.report_month,
  c.account_number,
  c.description,
  c.current_period,
  c.year_to_date,
  c.entity,
  c.section,
  c.rule_applied
from pnl_classified_rows c
join pnl_uploads u on u.id = c.upload_id
where c.entity = 'Other'
   or c.rule_applied in ('savannah_hou_override', 'force_4670_to_savannah');