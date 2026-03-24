import sql from "mssql";

const config: sql.config = {
  user: process.env.MCLEOD_DB_USER,
  password: process.env.MCLEOD_DB_PASSWORD,
  server: process.env.MCLEOD_DB_SERVER || "",
  database: process.env.MCLEOD_DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getDb() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}