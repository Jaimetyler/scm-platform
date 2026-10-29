/* Read-only Dallas warehouse billing candidate export.
   One SELECT for McLeod's JDBC query tool; no DECLARE variables.
   Jan 1, 2025 through Oct 20, 2026 inclusive.
   Export the full result WITH HEADERS to CSV.
   Order totals repeat for each charge; they must be counted once per order.
   Charge lines are identified by company_id + charge_row_id.
   No customer/order-type filter here: the 3PL bridge is checked during import.
*/
SELECT
    o.company_id,
    o.id AS order_id,
    o.customer_id AS customer_code,
    o.revenue_code_id,
    o.order_type_id,
    o.status AS order_status,
    CONVERT(varchar(10), o.bill_date, 23) AS bill_date,
    o.total_charge AS total_order_revenue,
    o.rate AS order_base_rate,
    o.rate_type,
    o.rate_units,
    o.freight_charge,
    o.otherchargetotal AS other_charge_total,
    oc.id AS charge_row_id,
    oc.charge_id AS charge_code,
    oc.descr AS charge_description,
    oc.units AS charge_units,
    oc.amount AS charge_amount
FROM orders AS o
LEFT JOIN other_charge AS oc
    ON oc.company_id = o.company_id
   AND oc.order_id = o.id
WHERE o.company_id = 'TMS'
  AND o.revenue_code_id = 'DLOCA'
  AND o.bill_date >= '20250101'
  AND o.bill_date < '20261021'
ORDER BY o.bill_date, o.id, oc.id;
