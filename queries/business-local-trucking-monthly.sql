/* Remaining non-cotton local trucking, compact monthly export.
   One row per customer/month/revenue-code/location pair, not charge line.
   Read-only SELECT; export ALL rows WITH HEADERS to CSV.
   Excludes eCotton and 3PL warehouse invoices already loaded separately.
   Excludes COTTON local loads already loaded from the cotton sources.
*/
SELECT
    o.company_id,
    o.customer_id AS customer_code,
    c.name AS customer_name,
    c.bridge_id AS customer_bridge,
    o.revenue_code_id,
    CONVERT(varchar(7),o.bill_date,120) AS bill_month,
    pu.location_id AS pickup_location_id,
    so.location_id AS delivery_location_id,
    COUNT(*) AS trucking_loads,
    SUM(o.total_charge) AS trucking_revenue,
    SUM(CASE WHEN m.id=o.curr_movement_id AND m.override_pay_amt IS NOT NULL
             THEN m.override_pay_amt ELSE 0 END) AS verified_carrier_pay,
    SUM(CASE WHEN m.id=o.curr_movement_id AND m.override_pay_amt IS NOT NULL
             THEN o.total_charge ELSE 0 END) AS revenue_with_verified_pay,
    SUM(CASE WHEN m.id=o.curr_movement_id AND m.override_pay_amt IS NOT NULL
             THEN 0 ELSE 1 END) AS missing_carrier_pay_loads,
    SUM(CASE WHEN o.total_charge=0 THEN 1 ELSE 0 END) AS zero_revenue_loads,
    SUM(CASE WHEN o.total_charge IS NULL THEN 1 ELSE 0 END) AS missing_revenue_loads
FROM orders AS o
LEFT JOIN customer AS c ON c.company_id=o.company_id AND c.id=o.customer_id
LEFT JOIN movement AS m ON m.company_id=o.company_id AND m.id=o.curr_movement_id
LEFT JOIN stop AS pu ON pu.company_id=o.company_id AND pu.id=o.shipper_stop_id
LEFT JOIN stop AS so ON so.company_id=o.company_id AND so.id=o.consignee_stop_id
WHERE o.company_id='TMS'
  AND o.revenue_code_id IN ('LOCAL','HLOCA','HLOCAL','DLOCA')
  AND COALESCE(o.order_type_id,'') NOT IN ('ECOTTON','3PL')
  AND COALESCE(o.commodity_id,'')<>'COTTON'
  AND (o.status<>'V' OR o.status IS NULL)
  AND o.bill_date >= '20250101' AND o.bill_date < '20261021'
GROUP BY o.company_id,o.customer_id,c.name,c.bridge_id,o.revenue_code_id,
         CONVERT(varchar(7),o.bill_date,120),pu.location_id,so.location_id
ORDER BY bill_month,o.customer_id,o.revenue_code_id;
