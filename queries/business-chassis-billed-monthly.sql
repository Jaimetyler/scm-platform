/* Chassis billed: compact monthly charge summary, same report bill-date window.
   Revenue-only subtotal ALREADY INCLUDED in invoice totals. Do not add it twice.
   No chassis cost or profit is inferred. Export ALL rows WITH HEADERS to CSV.
   Revenue codes determine chassis business units in the report.
*/
SELECT
    o.company_id,
    o.customer_id AS customer_code,
    c.name AS customer_name,
    c.bridge_id AS customer_bridge,
    o.revenue_code_id,
    o.order_type_id,
    o.commodity_id,
    CONVERT(varchar(7),o.bill_date,120) AS bill_month,
    oc.charge_id AS charge_code,
    oc.descr AS charge_description,
    COUNT(*) AS charge_lines,
    SUM(oc.amount) AS chassis_billed,
    SUM(CASE WHEN oc.amount IS NULL THEN 1 ELSE 0 END) AS missing_charge_amounts
FROM orders AS o
JOIN other_charge AS oc ON oc.company_id=o.company_id AND oc.order_id=o.id
LEFT JOIN customer AS c ON c.company_id=o.company_id AND c.id=o.customer_id
WHERE o.company_id='TMS'
  AND (o.status<>'V' OR o.status IS NULL)
  AND o.bill_date >= '20250101' AND o.bill_date < '20261021'
  AND (LOWER(COALESCE(oc.descr,'')) LIKE '%chassis%'
       OR oc.charge_id IN ('019','SPC','HPC','HSPT','SCS'))
GROUP BY o.company_id,o.customer_id,c.name,c.bridge_id,o.revenue_code_id,
         o.order_type_id,o.commodity_id,CONVERT(varchar(7),o.bill_date,120),oc.charge_id,oc.descr
ORDER BY bill_month,o.revenue_code_id,o.customer_id,oc.charge_id;
