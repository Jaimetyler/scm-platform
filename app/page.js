import { getSupabaseServerClient } from "../lib/supabase/server";

function formatCurrency(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(num);
}

function formatMonth(value) {
  if (!value) return "Unknown Month";
  const date = new Date(value + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

export default async function HomePage() {
  const supabase = getSupabaseServerClient();

  const { data: latestMonthRow, error: latestMonthError } = await supabase
    .from("v_pnl_monthly_summary")
    .select("report_month")
    .order("report_month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestMonthError) {
    throw new Error(latestMonthError.message);
  }

  const latestMonth = latestMonthRow?.report_month ?? null;

  let rows = [];

  if (latestMonth) {
    const { data, error } = await supabase
      .from("v_pnl_monthly_summary")
      .select("report_month, entity, income, expense, net")
      .eq("report_month", latestMonth)
      .order("entity", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    rows = data ?? [];
  }

  const totalIncome = rows.reduce((sum, row) => sum + Number(row.income || 0), 0);
  const totalExpense = rows.reduce((sum, row) => sum + Number(row.expense || 0), 0);
  const totalNet = rows.reduce((sum, row) => sum + Number(row.net || 0), 0);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>SCM P&amp;L Dashboard</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            Latest report: {formatMonth(latestMonth)}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
          marginBottom: 24
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>Total Income</div>
          <div style={valueStyle}>{formatCurrency(totalIncome)}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Total Expense</div>
          <div style={valueStyle}>{formatCurrency(totalExpense)}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Net</div>
          <div style={valueStyle}>{formatCurrency(totalNet)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Entity Summary</h2>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#fff"
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={thStyle}>Entity</th>
                <th style={thStyle}>Income</th>
                <th style={thStyle}>Expense</th>
                <th style={thStyle}>Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.report_month}-${row.entity}`} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={tdStyle}>{row.entity}</td>
                  <td style={tdStyle}>{formatCurrency(row.income)}</td>
                  <td style={tdStyle}>{formatCurrency(row.expense)}</td>
                  <td style={tdStyle}>{formatCurrency(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)"
};

const labelStyle = {
  fontSize: 13,
  color: "#666",
  marginBottom: 10
};

const valueStyle = {
  fontSize: 28,
  fontWeight: 700
};

const thStyle = {
  padding: "12px 14px",
  fontSize: 14,
  color: "#555"
};

const tdStyle = {
  padding: "14px"
};