/* Cotton warehouse split: compact monthly export for ALL three locations.
   Correctly classifies storage/STG credits and shipping/receiving adjustments.
   Read-only SELECT. Export all rows WITH HEADERS to ONE CSV.
   Invoice reconciliation issues must be zero before importing.
   This supersedes the earlier four invoice-split exports.
*/
SELECT
    o.company_id,
    o.customer_id AS customer_code,
    o.revenue_code_id,
    CONVERT(varchar(7),o.bill_date,120) AS bill_month,
    COUNT(*) AS warehouse_invoices,
    SUM(o.total_charge) AS warehouse_revenue,
    SUM(COALESCE(ch.handling_amount,0)) AS warehouse_handling,
    SUM(COALESCE(ch.storage_amount,0)) AS warehouse_storage,
    SUM(COALESCE(ch.other_amount,0)+o.freight_charge) AS warehouse_other,
    SUM(CASE WHEN o.total_charge IS NULL OR o.freight_charge IS NULL
                  OR o.otherchargetotal IS NULL OR COALESCE(ch.null_charge_amounts,0)<>0
                  OR COALESCE(ch.charge_line_total,0)<>o.otherchargetotal
                  OR o.freight_charge+o.otherchargetotal<>o.total_charge
                  OR COALESCE(ch.handling_amount,0)+COALESCE(ch.storage_amount,0)
                     +COALESCE(ch.other_amount,0)+o.freight_charge<>o.total_charge
             THEN 1 ELSE 0 END) AS invoice_reconciliation_issues
FROM orders AS o
OUTER APPLY (
    SELECT
        SUM(oc.amount) AS charge_line_total,
        SUM(CASE WHEN oc.amount IS NULL THEN 1 ELSE 0 END) AS null_charge_amounts,
        SUM(CASE WHEN (LOWER(COALESCE(oc.descr,'')) LIKE '%stor%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%stg%' OR COALESCE(oc.charge_id,'') IN ('DCS','DC36','CTS','HCS','SC34','SC44','H106')) THEN oc.amount ELSE 0 END) AS storage_amount,
        SUM(CASE WHEN NOT (LOWER(COALESCE(oc.descr,'')) LIKE '%stor%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%stg%' OR COALESCE(oc.charge_id,'') IN ('DCS','DC36','CTS','HCS','SC34','SC44','H106')) AND (LOWER(COALESCE(oc.descr,'')) LIKE '%recei%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%receipt%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%ship%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%handling%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%loading%' OR COALESCE(oc.charge_id,'') IN ('DCRS','DCH','DC23','DC64','DC65')) THEN oc.amount ELSE 0 END) AS handling_amount,
        SUM(CASE WHEN NOT (LOWER(COALESCE(oc.descr,'')) LIKE '%stor%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%stg%' OR COALESCE(oc.charge_id,'') IN ('DCS','DC36','CTS','HCS','SC34','SC44','H106')) AND NOT (LOWER(COALESCE(oc.descr,'')) LIKE '%recei%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%receipt%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%ship%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%handling%' OR LOWER(COALESCE(oc.descr,'')) LIKE '%loading%' OR COALESCE(oc.charge_id,'') IN ('DCRS','DCH','DC23','DC64','DC65')) THEN oc.amount ELSE 0 END) AS other_amount
    FROM other_charge AS oc
    WHERE oc.company_id=o.company_id AND oc.order_id=o.id
) AS ch
WHERE o.company_id='TMS'
  AND o.order_type_id='ECOTTON'
  AND o.revenue_code_id IN ('LOCAL','HLOCA','HLOCAL','DLOCA')
  AND (o.status<>'V' OR o.status IS NULL)
  AND o.bill_date >= '20250101'
  AND o.bill_date < '20261021'
GROUP BY o.company_id,o.customer_id,o.revenue_code_id,CONVERT(varchar(7),o.bill_date,120)
ORDER BY o.revenue_code_id,o.customer_id,bill_month;
