import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/*
  Calculate previous month as YYYY-MM-01
*/
function getPreviousMonth() {

  const today = new Date();

  const firstOfThisMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  const previousMonth = new Date(firstOfThisMonth);

  previousMonth.setMonth(previousMonth.getMonth() - 1);

  return previousMonth.toISOString().slice(0, 10);

}

function toNumber(value) {

  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") return value;

  const cleaned = String(value).replace(/[$,()]/g, "").trim();

  if (!cleaned) return null;

  const negative = String(value).includes("(");

  const num = Number(cleaned);

  if (Number.isNaN(num)) return null;

  return negative ? -num : num;

}

function isValidRow(account, description, current, ytd) {

  return (
    account &&
    description &&
    (current !== null || ytd !== null)
  );

}

async function importWorkbook(filePath, reportMonth) {

  const fileName = path.basename(filePath);

  console.log("Reading workbook:", fileName);
  console.log("Report month:", reportMonth);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null
  });

  console.log("Rows detected:", rows.length);

  const { data: upload, error: uploadError } = await supabase
    .from("pnl_uploads")
    .insert({
      file_name: fileName,
      report_month: reportMonth,
      source_sheet: sheetName,
      status: "pending"
    })
    .select()
    .single();

  if (uploadError) {

    console.error(uploadError);
    throw uploadError;

  }

  console.log("Upload ID:", upload.id);

  const rawRows = [];

  for (let i = 0; i < rows.length; i++) {

    const row = rows[i];

    const account = row[0] ? String(row[0]).trim() : null;
    const description = row[1] ? String(row[1]).trim() : null;

    const current = toNumber(row[3]);
    const ytd = toNumber(row[5]);

    if (isValidRow(account, description, current, ytd)) {

      rawRows.push({
        upload_id: upload.id,
        row_number: i + 1,
        account_number: account,
        description,
        current_period: current,
        year_to_date: ytd,
        source_sheet: sheetName
      });

    }

  }

  console.log("Valid rows:", rawRows.length);

  if (rawRows.length > 0) {

    const { error: insertError } = await supabase
      .from("pnl_raw_rows")
      .insert(rawRows);

    if (insertError) {

      console.error(insertError);
      throw insertError;

    }

  }

  console.log("Running classification...");

  const { error: processError } = await supabase.rpc(
    "process_pnl_upload",
    { p_upload_id: upload.id }
  );

  if (processError) {

    console.error(processError);
    throw processError;

  }

  console.log("Import complete.");

}

const filePath = process.argv[2];
const reportMonth = process.argv[3] || getPreviousMonth();

if (!filePath) {

  console.error("Usage: node import-pnl.js <file.xlsx> [report-month]");
  process.exit(1);

}

importWorkbook(filePath, reportMonth)
  .catch(err => {
    console.error(err);
    process.exit(1);
  });