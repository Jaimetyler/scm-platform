/* Cotton Savannah 2026: warehouse only, one row per invoice.
   Read-only SELECT. Export ALL rows WITH HEADERS to its own CSV.
   Handling/storage/other are components of total revenue, not extra revenue.
   Prior trucking and Dallas exports are not needed again.
*/
SELECT
    o.company_id,
    o.id AS order_id,
    o.customer_id AS customer_code,
    o.order_type_id,
    CONVERT(varchar(10),o.bill_date,23) AS bill_date,
    o.total_charge AS total_order_revenue,
    o.freight_charge,
    o.otherchargetotal AS other_charge_total,
    COALESCE(ch.charge_line_total,0) AS charge_line_total,
    COALESCE(ch.null_charge_amounts,0) AS null_charge_amounts,
    COALESCE(ch.handling_amount,0) AS warehouse_handling,
    COALESCE(ch.storage_amount,0) AS warehouse_storage,
    COALESCE(ch.other_amount,0) + o.freight_charge AS warehouse_other
FROM orders AS o
OUTER APPLY (
    SELECT
        SUM(oc.amount) AS charge_line_total,
        SUM(CASE WHEN oc.amount IS NULL THEN 1 ELSE 0 END) AS null_charge_amounts,
        SUM(CASE WHEN (LOWER(COALESCE(oc.descr,'')) LIKE '%stor%' OR COALESCE(oc.charge_id,'') IN ('DCS','DC36','CTS')) THEN oc.amount ELSE 0 END) AS storage_amount,
        SUM(CASE WHEN NOT (LOWER(COALESCE(oc.descr,'')) LIKE '%stor%' OR COALESCE(oc.charge_id,'') IN ('DCS','DC36','CTS')) AND (LOWER(COALESCE(oc.descr,'')) LIKE '%receiv%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%receipt%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%shipping%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%handling%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%loading%' OR COALESCE(oc.charge_id,'') IN ('DCRS','DCH','DC23')) THEN oc.amount ELSE 0 END) AS handling_amount,
        SUM(CASE WHEN NOT (LOWER(COALESCE(oc.descr,'')) LIKE '%stor%' OR COALESCE(oc.charge_id,'') IN ('DCS','DC36','CTS')) AND NOT (LOWER(COALESCE(oc.descr,'')) LIKE '%receiv%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%receipt%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%shipping%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%handling%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%loading%' OR COALESCE(oc.charge_id,'') IN ('DCRS','DCH','DC23')) THEN oc.amount ELSE 0 END) AS other_amount
    FROM other_charge AS oc
    WHERE oc.company_id=o.company_id AND oc.order_id=o.id
) AS ch
WHERE o.company_id='TMS'
  AND o.order_type_id='ECOTTON'
  AND o.revenue_code_id IN ('LOCAL')
  AND o.bill_date >= '20260101'
  AND o.bill_date < '20261021'
ORDER BY o.bill_date,o.id;
