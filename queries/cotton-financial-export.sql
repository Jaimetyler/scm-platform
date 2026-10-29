/* Cotton financial report: one read-only SELECT for McLeod JDBC.
   Same comparison period as Warehouse Intelligence: Jan 1, 2025–Oct 20, 2026.
   Export the complete result WITH HEADERS, not a TOP/sample.
   HLOCAL and HLOCA are both extracted so Houston spelling can be verified.
   Header amounts repeat per charge row: count each company/order once.
   Keep every unique company/charge_row_id for warehouse charge classification.
   ECOTTON takes precedence over local drayage; never count both categories.
*/
SELECT
    o.company_id,
    o.id AS order_id,
    o.customer_id AS customer_code,
    c.name AS customer_name,
    c.bridge_id AS customer_bridge,
    o.revenue_code_id,
    o.order_type_id,
    o.commodity_id,
    o.status AS order_status,
    CONVERT(varchar(10), o.bill_date, 23) AS bill_date,
    o.total_charge AS total_order_revenue,
    o.freight_charge,
    o.otherchargetotal AS other_charge_total,
    o.rate AS order_base_rate,
    o.rate_units,
    o.curr_movement_id,
    m.id AS matched_current_movement_id,
    m.status AS movement_status,
    m.override_payee_id AS carrier_code,
    m.override_pay_amt AS current_movement_override_pay_amt,
    o.shipper_stop_id AS pickup_stop_id,
    pu.location_id AS pickup_location_id,
    o.consignee_stop_id AS delivery_stop_id,
    so.location_id AS delivery_location_id,
    oc.id AS charge_row_id,
    oc.charge_id AS charge_code,
    oc.descr AS charge_description,
    oc.units AS charge_units,
    oc.amount AS charge_amount,
    oc.incl_in_freight AS charge_included_in_freight
FROM orders AS o
LEFT JOIN customer AS c
    ON c.company_id = o.company_id AND c.id = o.customer_id
LEFT JOIN movement AS m
    ON m.company_id = o.company_id AND m.id = o.curr_movement_id
LEFT JOIN stop AS pu
    ON pu.company_id = o.company_id AND pu.id = o.shipper_stop_id
LEFT JOIN stop AS so
    ON so.company_id = o.company_id AND so.id = o.consignee_stop_id
LEFT JOIN other_charge AS oc
    ON oc.company_id = o.company_id AND oc.order_id = o.id
WHERE o.company_id = 'TMS'
  AND o.bill_date >= '20250101'
  AND o.bill_date < '20261021'
  AND (
       (o.commodity_id = 'COTTON'
        AND o.revenue_code_id IN ('MAIN','DAVIS','DDRAY','LOCAL','HLOCAL','HLOCA'))
       OR
       (o.order_type_id = 'ECOTTON'
        AND o.revenue_code_id IN ('LOCAL','HLOCAL','HLOCA','DLOCA'))
  )
ORDER BY o.bill_date, o.id, oc.id;
