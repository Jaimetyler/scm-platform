import { NextResponse } from "next/server";
import sql from "mssql";
import { withStaffAccess } from "@/lib/auth/guard";
import { salesOrdersApi } from "@/lib/reporting/sales-orders-api";
import { getDb } from "@/lib/mcleod/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const firstDate = "2025-01-01";
const pageSize = 25;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const GET = withStaffAccess(async request => {
  const params = request.nextUrl.searchParams;
  const from = params.get("from") ?? firstDate;
  const through = params.get("through") ?? new Date().toLocaleDateString("sv-SE", {timeZone: "America/New_York"});
  const salesperson = params.get("salesperson") ?? "";
  const page = Number(params.get("page") ?? "1");
  if (!validDate(from) || !validDate(through) || from < firstDate || from > through ||
      through > "2099-12-31" || salesperson.length > 40 || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
    return NextResponse.json({error: "Choose a valid bill date range starting January 1, 2025 or later."}, {status: 400});
  }

  try {
    if (!process.env.MCLEOD_DB_SERVER || !process.env.MCLEOD_DB_NAME || !process.env.MCLEOD_DB_USER || !process.env.MCLEOD_DB_PASSWORD) {
      const report = await salesOrdersApi(from, through, salesperson, page, pageSize);
      return NextResponse.json(report, {headers: {"Cache-Control": "private, no-store"}});
    }
    const pool = await getDb();
    const result = await pool.request()
      .input("start", sql.Date, new Date(from))
      .input("end", sql.Date, new Date(through))
      .input("rep", sql.VarChar(40), salesperson)
      .input("offset", sql.Int, (page - 1) * pageSize)
      .input("pageSize", sql.Int, pageSize)
      .query(`
        SELECT DISTINCT LTRIM(RTRIM(salesperson_id)) AS salesperson
        FROM dbo.customer
        WHERE company_id = 'TMS' AND NULLIF(LTRIM(RTRIM(salesperson_id)), '') IS NOT NULL
        ORDER BY salesperson;

        SELECT o.id AS orderId, o.customer_id AS customerCode,
          COALESCE(NULLIF(LTRIM(RTRIM(c.name)), ''), o.customer_id) AS customerName,
          COALESCE(NULLIF(LTRIM(RTRIM(c.salesperson_id)), ''), '') AS salesperson,
          CONVERT(char(10), o.bill_date, 23) AS billDate, o.status AS status,
          o.total_charge AS revenue, m.override_pay_amt AS carrierPay
        INTO #sales_orders
        FROM dbo.orders o
        LEFT JOIN dbo.customer c ON c.company_id = o.company_id AND c.id = o.customer_id
        LEFT JOIN dbo.movement m ON m.company_id = o.company_id AND m.id = o.curr_movement_id
        WHERE o.company_id = 'TMS' AND o.bill_date >= @start AND o.bill_date < DATEADD(day, 1, @end)
          AND (@rep = '' OR (@rep = '~unassigned' AND NULLIF(LTRIM(RTRIM(c.salesperson_id)), '') IS NULL)
            OR LTRIM(RTRIM(c.salesperson_id)) = @rep);

        SELECT salesperson, COUNT(*) AS orders, SUM(revenue) AS revenue,
          SUM(carrierPay) AS recordedCarrierPay,
          SUM(CASE WHEN revenue IS NOT NULL AND carrierPay IS NOT NULL THEN revenue END) AS comparableRevenue,
          SUM(CASE WHEN revenue IS NOT NULL AND carrierPay IS NOT NULL THEN revenue - carrierPay END) AS margin,
          SUM(CASE WHEN revenue IS NULL OR carrierPay IS NULL THEN 1 ELSE 0 END) AS pending
        FROM #sales_orders GROUP BY salesperson ORDER BY salesperson;

        SELECT * FROM #sales_orders ORDER BY billDate DESC, orderId DESC
          OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
        DROP TABLE #sales_orders;
      `);
    const sets = result.recordsets as sql.IRecordSet<unknown>[];
    return NextResponse.json({people: sets[0], summaries: sets[1], orders: sets[2], pageSize},
      {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
    const number = error && typeof error === "object" && "number" in error ? error.number : undefined;
    console.error("Sales orders query failed", {code, number});
    return NextResponse.json({error: "McLeod billed orders are temporarily unavailable."}, {status: 503});
  }
});
