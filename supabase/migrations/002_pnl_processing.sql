create or replace function classify_pnl_entity(
  p_account_number text,
  p_description text
)
returns table (
  entity text,
  section text,
  rule_applied text
)
language plpgsql
as $$
declare
  acct text := coalesce(trim(p_account_number), '');
  descr text := coalesce(trim(p_description), '');
  acct_prefix_2 text := left(acct, 2);
begin
  if acct = '4670-00' then
    return query
    select 'Savannah Warehouse'::text, 'Expense'::text, 'force_4670_to_savannah'::text;
    return;
  end if;

  if acct_prefix_2 = '30' then
    return query
    select 'Brokerage'::text, 'Income'::text, 'prefix_30'::text;
    return;
  end if;

  if acct_prefix_2 = '31' or acct = '3991-00' then
    return query
    select 'Savannah Warehouse'::text, 'Income'::text, 'prefix_31_or_3991'::text;
    return;
  end if;

  if acct_prefix_2 = '32' then
    return query
    select 'Houston Warehouse'::text, 'Income'::text, 'prefix_32'::text;
    return;
  end if;

  if acct_prefix_2 = '34' then
    return query
    select 'Dallas Warehouse'::text, 'Income'::text, 'prefix_34'::text;
    return;
  end if;

  if acct_prefix_2 = '40' then
    return query
    select 'Brokerage'::text, 'Expense'::text, 'prefix_40'::text;
    return;
  end if;

  if acct_prefix_2 = '41' then
    if upper(descr) like '%HOU%' then
      return query
      select 'Houston Warehouse'::text, 'Expense'::text, 'savannah_hou_override'::text;
    else
      return query
      select 'Savannah Warehouse'::text, 'Expense'::text, 'prefix_41'::text;
    end if;
    return;
  end if;

  if acct_prefix_2 = '42' then
    return query
    select 'Houston Warehouse'::text, 'Expense'::text, 'prefix_42'::text;
    return;
  end if;

  if acct_prefix_2 = '44' then
    return query
    select 'Dallas Warehouse'::text, 'Expense'::text, 'prefix_44'::text;
    return;
  end if;

  if acct_prefix_2 = '45' then
    return query
    select 'SCMI'::text, 'Expense'::text, 'prefix_45'::text;
    return;
  end if;

  return query
  select 'Other'::text, 'Other'::text, 'fallback_other'::text;
end;
$$;

create or replace function process_pnl_upload(p_upload_id uuid)
returns void
language plpgsql
as $$
begin
  delete from pnl_rule_log
  where upload_id = p_upload_id;

  delete from pnl_classified_rows
  where upload_id = p_upload_id;

  insert into pnl_classified_rows (
    upload_id,
    raw_row_id,
    row_number,
    account_number,
    description,
    current_period,
    year_to_date,
    entity,
    section,
    rule_applied
  )
  select
    r.upload_id,
    r.id,
    r.row_number,
    r.account_number,
    r.description,
    r.current_period,
    r.year_to_date,
    c.entity,
    c.section,
    c.rule_applied
  from pnl_raw_rows r
  cross join lateral classify_pnl_entity(r.account_number, r.description) c
  where r.upload_id = p_upload_id
    and coalesce(trim(r.account_number), '') <> '';

  insert into pnl_rule_log (
    upload_id,
    raw_row_id,
    account_number,
    description,
    rule_name,
    to_entity,
    note
  )
  select
    upload_id,
    raw_row_id,
    account_number,
    description,
    rule_applied,
    entity,
    'Auto-classified during upload processing'
  from pnl_classified_rows
  where upload_id = p_upload_id;

  update pnl_uploads
  set status = 'processed'
  where id = p_upload_id;
end;
$$;