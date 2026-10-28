/* Read-only full-period TERRY export. One SELECT; no DECLARE statements.
   Export all rows WITH HEADERS. Existing MAIN/CNTR/DAVIS/DDRAY data is retained.
   Customer bridge columns identify 3PL accounts missing from the old mapping.
   Multiple bridge accounts can repeat an order: retain rows for review and
   count each company/order only once when importing financial amounts.
*/
SELECT
    o.company_id,
    o.id AS order_id,
    o.customer_id AS customer_code,
    tc.name AS trucking_customer_name,
    o.revenue_code_id,
    o.order_type_id,
    o.status AS order_status,
    CONVERT(varchar(10), o.bill_date, 23) AS bill_date,
    o.total_charge AS total_invoice_revenue,
    o.freight_charge,
    o.otherchargetotal AS other_charge_total,
    o.curr_movement_id,
    m.id AS matched_current_movement_id,
    m.status AS movement_status,
    m.brokerage_status,
    m.override_payee_id AS carrier_code,
    m.override_pay_amt AS current_movement_override_pay_amt,
    o.shipper_stop_id AS pickup_stop_id,
    pu.location_id AS pickup_location_id,
    o.consignee_stop_id AS delivery_stop_id,
    so.location_id AS delivery_location_id,
    wc.id AS warehouse_customer_code,
    wc.name AS warehouse_customer_name,
    wc.bridge_id AS warehouse_trucking_bridge
FROM orders AS o
LEFT JOIN movement AS m
    ON m.company_id = o.company_id AND m.id = o.curr_movement_id
LEFT JOIN stop AS pu
    ON pu.company_id = o.company_id AND pu.id = o.shipper_stop_id
LEFT JOIN stop AS so
    ON so.company_id = o.company_id AND so.id = o.consignee_stop_id
LEFT JOIN customer AS tc
    ON tc.company_id = o.company_id AND tc.id = o.customer_id
LEFT JOIN customer AS wc
    ON wc.company_id = o.company_id AND wc.bridge_id = o.customer_id
   AND wc.id LIKE '3PL%'
WHERE o.company_id = 'TMS'
  AND o.revenue_code_id = 'TERRY'
  AND (o.order_type_id IS NULL OR o.order_type_id <> 'ECOTTON')
  AND o.bill_date >= '20250101'
  AND o.bill_date < '20261021'
ORDER BY o.bill_date, o.id, wc.id;
